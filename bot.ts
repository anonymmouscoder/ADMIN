import {
  Bot,
  freeStorage,
  Fuse,
  getTimeZones,
  InlineKeyboard,
  lazySession,
  timeZonesNames,
} from "./deps.ts";
import {
  _24to12,
  admins,
  containsAdminMention,
  esc,
  getDisplayTime,
  getRandomReply,
  getUser,
  getUserTime,
  hoursKeyboard,
  HTML,
  isAvailable,
  nonAdmins,
  REPORT_BOT_REPLIES,
  UNAVAIL_KEYBOARD1,
} from "./helpers.ts";
import {
  Context,
  customMethods,
  ReportContext,
  SessionData,
} from "./context.ts";

export const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN is missing");
export const bot = new Bot<Context>(TOKEN);

const storage = freeStorage<SessionData>(bot.token);
bot.use(lazySession({ storage, initial: () => ({ dnd: false }) }));
bot.use(customMethods);
bot.catch(console.error);
// Attribuez des paramètres toujours utilisés à la charge utile.
bot.api.config.use((prev, method, payload, signal) =>
  prev(method, {
    ...payload,
    disable_web_page_preview: true,
    allow_sending_without_reply: true,
  }, signal)
);

const pm = bot.chatType("private");
const grp = bot.chatType(["group", "supergroup"]);
const exceptChannel = bot.chatType(["private", "group", "supergroup"]);

async function reportHandler(ctx: ReportContext) {
  const reportedMsg = ctx.msg.reply_to_message;
  if (!reportedMsg) {
    return await ctx.comment("Répondez /report à un message.");
  }

// Message transféré du canal connecté.
  if (reportedMsg.is_automatic_forward) return;

  const report = getUser(reportedMsg);

  if (report.id === ctx.me.id) {
    return await ctx.comment(getRandomReply(REPORT_BOT_REPLIES));
  }

  // Peut-être en tant que chaînes ?
  if (reportedMsg.sender_chat === undefined) {
    const member = await ctx.getChatMember(report.id);
    if (member.status === "administrator" || member.status === "creator") {
      return;
    }
  }

  let msg = `Signalement à <a href="${
    report.is_user
      ? `tg://user?id=${report.id}`
      : `https://t.me/${report.username}` // pas possible d'envoyer des messages en tant que canaux privés : sûr de supposer qu'il y aura un nom d'utilisateur
  }">${esc(report.first_name)}</a> [<code>${report.id}</code>]\n`;

  let availableAdmins = 0;
  const admins = await ctx.getChatAdministrators();

  await Promise.all(admins.map(async (admin) => {
    if (admin.is_anonymous || admin.user.is_bot) return;
    const user = await storage.read(`${admin.user.id}`);
    if (user) {
      if (user.dnd) return;
// Admin est actuellement indisponible selon le fuseau horaire et l'intervalle qu'ils ont définis.
      if (!isAvailable(user)) return;
    }

    availableAdmins++;
    msg += admin.user.username
      ? `@${esc(admin.user.username)} `
      : `<a href="tg://user?id=${admin.user.id}">${
        esc(admin.user.first_name)
      }</a> `;
  }));

// Si tous les administrateurs ne sont pas disponibles pour le moment, taguez simplement le créateur du chat.
  if (availableAdmins === 0) {
    const creator = admins.find((admin) => admin.status === "creator");
    // Il se peut qu'il n'y ait pas de créateur ou que les administrateurs soient anonymes.
    if (creator) {
      msg += creator.user.username
        ? `@${esc(creator.user.username)} `
        : `<a href="tg://user?id=${creator.user.id}">${
          esc(creator.user.first_name)
        }</a> `;
    }
  }

  try {
    await ctx.deleteMessage();
  } catch (_e) {
    // Peut-être que le message "/report" a été supprimé :/
     // Ou Bot n'a pas la permission de supprimer.
  }

  await ctx.reply(msg, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Résolu", "handled"),
    reply_to_message_id: reportedMsg.message_id,
  });
}

grp.callbackQuery([
  "handled",
  "mark-as-handled", // messages existant
]).filter(admins, async (ctx) => {
  await ctx.alert("Marqué comme résolu.");
  await ctx.deleteMessage();
});

grp.command(["report", "admin"])
  .filter(nonAdmins, reportHandler);

grp.on(["msg:entities:mention", "msg:caption_entities:mention"])
  .filter(containsAdminMention)
  .filter(nonAdmins, reportHandler);

// ce qui suit fonctionne également. mais pas aussi bon que le filtrage ci-dessus.
// grp.hears(/.*(\s|^)(@admins?)\b.*/g, reportHandler);

pm.command(
  ["report", "admin"],
  (ctx) => ctx.reply("Cela ne fonctionne qu'en groupe."),
);

pm.command(["tz", "timezone"], async (ctx) => {
  const session = await ctx.session;
  const statusText = session.tz
    ? `Vous avez défini <b>${session.tz}</b> comme fuseau horaire. Utilisez /clear_tz pour le supprimer.`
    : `Vous n'avez pas encore configuré de fuseau horaire. \
Vous pouvez trouver votre emplacement de fuseau horaire en allant <a href="https://tzone.deno.dev">ici</a>, ou en en recherchant un.`;

  if (!ctx.match) {
    return await ctx.reply(
      `Passez votre fuseau horaire en argument.
      Exemples
      - <code>/tz Europe/Berlin</code>
      - <code>/tz berlin</code>
      - <code>/tz berl</code> (Rechercher)

${statusText}

<b>Fuseau horaire</b>
Vous pouvez définir un <a href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones">fuseau horaire</a>, et je ne vous marquerai pas pour les rapports pendant que vous n'êtes pas disponible. \
Par défaut, vous êtes considéré comme indisponible s'il fait nuit à votre emplacement. \
Vous pouvez personnaliser la période d'indisponibilité par défaut (de 0h00 à 6h00) à l'aide de la commande /unavail.`,
      HTML,
    );
  }

  const timezone = ctx.match.trim();
  if (timezone.length === 1) {
    return await ctx.reply(
      "Qu'est-ce que c'est? Spécifiez un peu plus votre fuseau horaire. Au moins deux caractères.",
    );
  }

  // cela ne devrait jamais être une constante globale depuis le fuseau horaire
   // le décalage peut changer en raison de l'heure d'été.
  const timezones = getTimeZones();

  if (timeZonesNames.includes(timezone)) {
    const tz = timezones.find((tz) => tz.group.includes(timezone));
    // on est assuré qu'il y en aura un. Mais c'est toujours agréable d'attraper chaque cas.
    if (!tz) {
      return await ctx.answerCallbackQuery("Impossible de trouver le fuseau horaire");
    }

    if (!session.interval) session.interval = [0, 6]; // 12AM à 6AM
    ctx.session = {
      ...session,
      tz: timezone,
    };

    const userTime = getUserTime(tz.currentTimeOffsetInMinutes);
    return await ctx.reply(
      `L'emplacement du fuseau horaire a été défini sur <b>${timezone}</b>. \
      Je suppose qu'il est ${getDisplayTime(userTime)} chez vous.`,
      HTML,
    );
  }

  const results = new Fuse(timezones, {
    findAllMatches: true,
    minMatchCharLength: timezone.length,
    threshold: 0.5,
    keys: ["group", "countryName", "mainCities"],
  }).search(timezone).splice(0, 100);

  // invalide
  if (!results.length) {
    return await ctx.reply(
      "Impossible de trouver des fuseaux horaires liés à cela. Veuillez entrer quelque chose de valide.",
    );
  }

  const kb = new InlineKeyboard();
  for (let i = 0; i < results.length; i++) {
    const { item } = results[i];
    kb.text(item.name, `set-loc_${item.name}`);
    if (i % 2 === 1) kb.row();
  }

  return await ctx.reply(`Vouliez-vous dire...?`, { reply_markup: kb });
});

pm.callbackQuery(/set-loc_(.+)/, async (ctx) => {
  if (!ctx.match) {
    return await ctx.answerCallbackQuery("Requête invalide :(");
  }

  const session = await ctx.session;
  await ctx.answerCallbackQuery();
  const location = ctx.match[1];
  const tz = getTimeZones().find((tz) => tz.group.includes(location));
  if (!tz) {
    return await ctx.answerCallbackQuery("Impossible de trouver le fuseau horaire");
  }

  if (!session.interval) session.interval = [0, 6]; // 12AM a 6AM
  ctx.session = {
    ...session,
    tz: location,
  };

  const userTime = getUserTime(tz.currentTimeOffsetInMinutes);
  await ctx.editMessageText(
    `L'emplacement du fuseau horaire a été défini sur <b>${location}</b>. \
    Je suppose que l'heure est ${getDisplayTime(userTime)} chez vous.`,
    HTML,
  );
});

pm.command("clear_tz", async (ctx) => {
  const session = await ctx.session;
  ctx.session = {
    ...session,
    tz: undefined,
    interval: undefined,
  };
  await ctx.reply(
    "Le fuseau horaire a été effacé. Vous pouvez en définir un nouveau à l'aide de la commande /tz.",
  );
});

pm.command("dnd", async (ctx) => {
  const dnd = (await ctx.session).dnd;
  (await ctx.session).dnd = !dnd;
  await ctx.reply(
    !dnd
      ? "Mode Ne pas déranger activé. Vous ne recevrez aucune mention tant que vous ne l'aurez pas désactivé en utilisant à nouveau /dnd."
      : "Mode Ne pas déranger désactivé. Vous recevrez des rapports lorsque vous serez disponible.",
  );
});

// Fonction d'indisponibilité
pm.command("unavail", async (ctx) => {
  const { interval, tz } = await ctx.session;
  if (!tz) {
    return await ctx.reply(
      "Vous devez définir un fuseau horaire à l'aide de /tz pour utiliser cette fonctionnalité.",
    );
  }

  const statusText = interval
    ? `Votre période d'indisponibilité actuelle est \
    <b>de ${_24to12(interval[0])} à ${_24to12(interval[1])}</b>. \
    Vous pouvez le modifier à l'aide du bouton ci-dessous.`
         : `Vous avez entièrement désactivé cette fonctionnalité. Vous pouvez l'activer en utilisant le bouton ci-dessous.`;

  await ctx.reply(
    `${statusText}

    Dans votre vie quotidienne, vous n'êtes probablement pas disponible 24h/24 et 7j/7. Vous avez besoin de sommeil et vous avez peut-être du travail. \
    Ainsi, pendant que vous n'êtes pas disponible, c'est une perturbation si le bot vous marque lorsque des personnes/signalent. \
    Avec cette fonction, vous pouvez définir une période pendant laquelle vous êtes censé être indisponible. \
    Si une telle période d'indisponibilité est définie, le bot vérifiera si vous êtes disponible ou non avant de vous taguer.
    
    <b>Remarque</b> : Cette fonctionnalité ne fonctionnera pas si vous êtes le créateur du chat et qu'aucun autre administrateur n'est disponible.
    
    — Vous pouvez désactiver cette fonctionnalité avec /disable_unavail et recevoir des mentions tout le temps.
    — Exécutez /am_i_available pour vérifier si vous êtes disponible maintenant ou non. (déboguer)`,
    {
      ...HTML,
      reply_markup: new InlineKeyboard()
        .text(interval ? "Changer" : "Activer", "change-unavail-time"),
    },
  );
});

pm.callbackQuery("change-unavail-time", async (ctx) => {
  const session = await ctx.session;
  if (!session.tz) {
    return await ctx.alert(
      "Vous devez d'abord définir un fuseau horaire à l'aide de la commande /tz pour utiliser cette fonctionnalité.",
    );
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    "Vous n'êtes donc pas disponible, à partir de?",
    { reply_markup: UNAVAIL_KEYBOARD1 },
  );
});

pm.callbackQuery(/unavail-time-start_(\d+)/, async (ctx) => {
  if (!ctx.match) {
    return await ctx.answerCallbackQuery("Requête invalide:(");
  }
  const session = await ctx.session;
  if (!session.tz) {
    return await ctx.alert(
      "Vous devez d'abord définir un fuseau horaire à l'aide de la commande /tz pour utiliser cette fonctionnalité.",
    );
  }
  const startsAt = parseInt(ctx.match[1]);
  await ctx.answerCallbackQuery(`De ${_24to12(startsAt)}, à...`);
  const kb = hoursKeyboard(startsAt + 1, `unavail-time-end_${startsAt}`, false);
  await ctx.editMessageText("Lorsque vous redevenez disponible?", {
    reply_markup: kb,
  });
});

pm.callbackQuery(/unavail-time-end_(\d+)_(\d+)/, async (ctx) => {
  if (!ctx.match) {
    return await ctx.answerCallbackQuery("Requête invalide :(");
  }
  const session = await ctx.session;
  if (!session.tz) {
    return await ctx.alert(
      "Vous devez d'abord définir un fuseau horaire à l'aide de la commande /tz pour utiliser cette fonctionnalité.",
    );
  }
  await ctx.answerCallbackQuery();
  const startsAt = parseInt(ctx.match[1]);
  const endsAt = parseInt(ctx.match[2]);
  (await ctx.session).interval = [startsAt, endsAt];
  await ctx.editMessageText(
    `Vous ne serez donc pas disponible du ${_24to12(startsAt)} au ${_24to12(endsAt)}. \
    Je m'en souviendrai et je ne te taguerai pas à ce moment-là sauf si c'est nécessaire.`,
  );
});

pm.command("disable_unavail", async (ctx) => {
  if ((await ctx.session).interval === undefined) {
    return await ctx.reply("Déjà désactivé.");
  }
  (await ctx.session).interval = undefined;
  return await ctx.reply("La fonction d'indisponibilité a été désactivée.", {
    reply_markup: new InlineKeyboard()
      .text("Réactivez-le", "change-unavail-time"),
  });
});

pm.command("am_i_available", async (ctx) => {
  const session = await ctx.session;
  let msg = !session.tz
    ? "Je ne sais pas. Vous n'avez pas encore défini de fuseau horaire. Donc, je ne peux pas vraiment dire."
    : session.interval
    ? ` On dirait que tu es ${
      isAvailable(session) ? "" : "in"
    }disponible dès maintenant.`
    : "Pas sûr depuis que vous avez désactivé la fonctionnalité /unavail-ability.";

  if (session.dnd) {
    msg += session.interval && !isAvailable(session)
      ? " Et vous avez également /dnd activé."
      : " Mais vous avez activé /dnd en ce moment. Donc, je suppose que vous n'êtes pas disponible rn.";
  }
  await ctx.reply(msg);
});

exceptChannel.command("start", async (ctx) => {
  const { tz } = await ctx.session;
  const helpText = tz
    ? ""
    : "\nPour ce faire, j'ai besoin de votre /timezone. Vous pouvez simplement en définir un en utilisant /tz. \
    Je peux donc décider si vous êtes disponible ou non en fonction de votre période d'indisponibilité et de votre fuseau horaire, avant de vous mentionner. \
    Je vous aide également à passer en mode Ne pas déranger (/dnd), qui vous rend totalement indisponible jusqu'à ce que vous le désactiviez.\n";

  await ctx.reply(
    ctx.chat.type !== "private"
      ? "Salut! Pour de l'aide envoyez-moi /help."
      : `✋Salut! Je peux mentionner les administrateurs dans une discussion de groupe lorsque quelqu'un signale quelque chose. \
Mais, contrairement à d'autres bots qui font la même chose, je ne te tague que lorsque tu es disponible.
${helpText}
Voir /help pour plus d'informations.`,
  );
});

exceptChannel.command("help", async (ctx) => {
  await ctx.reply(
    ctx.chat.type !== "private"
      ? "Utilisez /report pour signaler quelqu'un aux administrateurs."
      : `Ajoutez-moi à votre groupe afin que je puisse aider les membres de votre groupe à signaler d'autres membres (tels que des spammeurs, etc.) aux administrateurs du groupe.\
Je suis différent des autres robots qui font la même chose car je suis conscient du temps!

<b>💆🏻Comment suis-je conscient du temps?</b>
Eh bien, je ne suis pas vraiment conscient du temps sans que vous définissiez votre temps avec /timezone. \
Si vous en définissez un, une période d'indisponibilité seara également définie (que vous pouvez personnaliser à l'aide de /unavail). \
C'est ça! Dès lors, chaque fois que quelqu'un utilisera la commande /report dans un groupe dont vous êtes l'administrateur, \
Je vérifierai votre heure actuelle, et si vous n'êtes pas disponible, je ne vous mentionnerai pas.

<b>Remarque</b> : Peu importe à quel point vous êtes occupé, vous recevrez des mentions si vous êtes le créateur du chat et si aucun autre administrateur n'est disponible pour le moment.

<b>🤐Mode Ne pas déranger</b>
Vous pouvez activer ou désactiver le mode <i>Ne pas déranger</i> en utilisant /dnd. \
Lorsque vous l'avez activé, le bot ne vous mentionnera pas du tout.

<b>🔥A propos</b>
Code source: https://github.com/anonymmouscoder/ADMIN
Par @A_liou de @codingtuto.`,
    HTML,
  );
});

await bot.init();
await bot.api.setMyCommands([
  { command: "tz", description: "Définir le fuseau horaire" },
  { command: "clear_tz", description: "Effacer le fuseau horaire" },
  { command: "unavail", description: "Définir la période d'indisponibilité" },
  { command: "dnd", description: "Activer le mode Ne pas déranger" },
  { command: "am_i_available", description: "Suis-je disponible ?" },
  { command: "help", description: "Aide" },
], { scope: { type: "all_private_chats" } });
