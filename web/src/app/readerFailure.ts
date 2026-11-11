// A reader that runs WebAssembly (the Revit, CAD and STEP readers) or a worker can stop on a file it
// can't handle: the trap reaches the page as a bare message ("unreachable", "RuntimeError: memory
// access out of bounds"), which says nothing to the person. These turn such a message into a plain
// sentence that asks for the file to be sent with Help > Report a Bug…, and leave every other message
// as the reader gave it.

/** The messages a WebAssembly trap or a worker's crash gives, not a reader's own. */
const TRAP = /\bunreachable\b|RuntimeError|memory access out of bounds|table index is out of bounds|function signature mismatch|^Aborted\(/i;

/** True for a message that is a trap (or empty, which a worker's crash gives too). */
export function isReaderStop(message: string): boolean {
  return message.trim() === "" || TRAP.test(message);
}

/** The sentence shown for a reader (named as the person knows it, e.g. "Revit") that stopped on the file. */
export function readerStoppedMessage(reader: string): string {
  return `Rodeo's ${reader} reader stopped on this file. Send it with Help > Report a Bug… so we can fix it.`;
}

/** The message to show for a failure `message` of `reader`: the plain sentence for a trap, the reader's own message otherwise. */
export function readerMessage(reader: string, message: string): string {
  return isReaderStop(message) ? readerStoppedMessage(reader) : message;
}
