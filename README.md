# ADMIN bot

> Construit avec [grammY](https://grammy.dev).

Bot de rapport simple et sensible au temps pour Telegram. Il écoute /report, /admin
commandes ou @admin, @admins mentionne dans les groupes et mentionne tous les administrateurs. Administrateurs
peuvent définir leur fuseau horaire et leur période d'indisponibilité dans le PM du bot et uniquement
recevoir des mentions lorsqu'elles sont disponibles.

Démo: [@bot](https://t.me/codingteamAdmin_bot)

Pour exécuter localement, assurez-vous d'avoir installé [Deno CLI](https://deno.land).

```sh
git clone https://github.com/dcdunkan/ryportbot.git
cd ryportbot
BOT_TOKEN="<YOUR-TOKEN>" deno run --allow-net --allow-env main.ts
```

Allez à [BotFather](https://t.me/botfather) et procurez-vous un `BOT_TOKEN`.

Cliquez
[ici](https://dash.deno.com/new?url=https://raw.githubusercontent.com/anonymmouscoder/ADMIN/main/serve.ts&env=BOT_TOKEN)
pour déployer votre propre instance sur Deno Deploy.
