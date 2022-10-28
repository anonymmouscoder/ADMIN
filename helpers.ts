import {
  ChatTypeContext,
  Filter,
  getTimeZones,
  InlineKeyboard,
  Message,
} from "./deps.ts";
import { Context, SessionData } from "./context.ts";

// Constantes
// Réponses aléatoires si quelqu'un signale le bot lui-même.
export const REPORT_BOT_REPLIES = [
  "Tu ne peux pas me signaler.",
  "Bien essayé",
  "Oh.",
  "Quoi?",
  "Hmm",
  "Lol",
];
export const UNAVAIL_KEYBOARD1 = hoursKeyboard(0, "unavail-time-start");

// Aide
export function getUserTime(offset: number) {
  const time = new Date();
  const t = time.getTime() + (time.getTimezoneOffset() * 60000) +
    (offset * 60000);
  return new Date(t);
}

export function getDisplayTime(time: Date) {
  return `${time.getHours().toString().padStart(2, "0")}:${
    time.getMinutes().toString().padStart(2, "0")
  }`;
}

function checkIfInBetween(offset: number, start: number, end: number) {
  let hours = getUserTime(offset).getHours();
  if (start > hours) hours += 24;
  // on s'assure que début et fin ne seront jamais égaux
  return start < end
    ? hours >= start && hours < end 
    : hours >= start && hours < (end + 24); 
}

export function isAvailable({ tz, interval }: SessionData) {
  
  if (!tz || !interval) return true;
  const offset = getTimeZones().find((t) => t.group.includes(tz))
    ?.currentTimeOffsetInMinutes!; 
  return !checkIfInBetween(offset, interval[0], interval[1]);
}

export function getRandomReply(replies: string[]) {
  return replies[Math.floor(Math.random() * replies.length)];
}

export function hoursKeyboard(
  startsAt: number,
  prefix: string,
  includeLast = true,
) {
  const kb = new InlineKeyboard();
  let actualIndex = 0;
  let limit = (includeLast ? 25 : 24);
  if (startsAt === 24) {
    startsAt = 0;
    limit--;
  }
  for (let i = startsAt; i < limit; i++) {
    kb.text(_24to12(i), `${prefix}_${i}`);
    if (i === 23) {
      i = -1; 
      limit = startsAt - 1;
    }
    actualIndex++;
    if (actualIndex % 4 === 0) kb.row();
  }
  return kb;
}

export function _24to12(x: number) {
  while (x > 23) x -= 24;
  return x === 0
    ? "12 AM"
    : x > 11 && x < 24
    ? (x === 12 ? 12 : x - 12).toString().padStart(2, "0") + " PM"
    : x.toString().padStart(2, "0") + " AM";
}

export function getUser(msg: Message) {
  return msg.sender_chat?.type === "channel"
    ? {
      first_name: msg.sender_chat.title,
      id: msg.sender_chat.id,
      username: msg.sender_chat.username,
      is_user: false,
    }
    : msg.sender_chat?.type === "group"
    ? {
      first_name: msg.sender_chat.title,
      id: msg.sender_chat.id,
      username: undefined,
      is_user: false,
    }
    : msg.sender_chat?.type === "supergroup"
    ? {
      first_name: msg.sender_chat.title,
      id: msg.sender_chat.id,
      username: msg.sender_chat.username,
      is_user: false,
    }
    : { ...msg.from!, is_user: msg.from?.is_bot ? false : true };
}

export function esc(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Option builders
export const HTML = { parse_mode: "HTML" as const };

// Predicates
export async function admins(ctx: Context) {
  const author = await ctx.getAuthor();
  if (author.status === "administrator" || author.status === "creator") {
    return true;
  }
  return false;
}

export async function nonAdmins(ctx: Context) {
  return !(await admins(ctx));
}

export function containsAdminMention(
  ctx: Filter<
    ChatTypeContext<Context, "group" | "supergroup">,
    "msg:entities:mention" | "msg:caption_entities:mention"
  >,
) {
  const text = (ctx.msg.text ?? ctx.msg.caption)!;
  return (ctx.msg.entities ?? ctx.msg.caption_entities)
    .find((e) => {
      const t = text.slice(e.offset, e.offset + e.length);
      return e.type === "mention" && (t === "@admin" || t === "@admins");
    }) !== undefined;
}
