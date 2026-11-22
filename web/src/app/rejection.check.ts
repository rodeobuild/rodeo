// Checks describeRejection under Node. Run from web/: npx tsx src/app/rejection.check.ts
import assert from "node:assert/strict";
import { describeRejection, isLostDeviceRejection, isOutOfMemoryError } from "./rejection.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const ev = new Event("error");
check(describeRejection(ev) === "Rejected with an Event (type: error)", "an Event says its type");
check(describeRejection("boom") === "boom", "a string is itself");
check(describeRejection(new TypeError("bad")) === "bad", "an Error gives its message");
check(describeRejection(null) === "Rejected with null", "null");
check(describeRejection(undefined) === "Rejected with undefined", "undefined");
check(describeRejection(42) === "Rejected with number 42", "a number");
const plain = describeRejection({ status: 500, body: "x" });
check(plain === 'Rejected with a plain object (keys: status, body): {"status":500,"body":"x"}', "a plain object: its keys and JSON");
class Thing {
  a = 1;
}
check(describeRejection(new Thing()).startsWith("Rejected with Thing (keys: a): "), "a class instance: its class name");
const cyc: Record<string, unknown> = { name: "loop" };
cyc.self = cyc;
check(describeRejection(cyc).includes("(not JSON"), "a cycle does not throw");
const big = { text: "x".repeat(5000) };
const long = describeRejection(big);
check(long.length < 400, `a big value is cut short (${long.length} characters)`);
const many: Record<string, number> = {};
for (let i = 0; i < 20; i++) many[`k${i}`] = i;
check(describeRejection(many).includes("+12 more"), "many keys: the first eight and a count");
check(describeRejection(Object.create(null)).startsWith("Rejected with a plain object"), "an object with no prototype");

check(isLostDeviceRejection("Failed to execute 'mapAsync' on 'GPUBuffer': [Device] is lost."), "a read on a lost WebGPU device");
check(isLostDeviceRejection("Device is lost"), "a lost device, plain wording");
check(!isLostDeviceRejection("Failed to execute 'mapAsync' on 'GPUBuffer': buffer is destroyed"), "another GPU buffer error is still reported");
check(!isLostDeviceRejection("the device list is lost"), "unrelated text about a device is still reported");

check(isOutOfMemoryError(new RangeError("Array buffer allocation failed")), "Chrome's allocation failure");
check(isOutOfMemoryError(new RangeError("Invalid typed array length: 4294967296")), "a typed array too long");
check(isOutOfMemoryError(new RangeError("Invalid array buffer length")), "an array buffer too long");
check(isOutOfMemoryError(new RangeError("Out of memory: Failed to allocate")), "Safari's out of memory");
check(!isOutOfMemoryError(new RangeError("Maximum call stack size exceeded")), "a stack overflow is not memory");
check(!isOutOfMemoryError(new TypeError("Array buffer allocation failed")), "only a RangeError counts");
check(!isOutOfMemoryError("Array buffer allocation failed"), "a string is not an error");

assert.ok(failures === 0, `${failures} failed`);
console.log(failures ? `${failures} FAILED` : "all ok");
