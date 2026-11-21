import assert from "node:assert/strict";
import test from "node:test";
import { sellerNoteRefusal } from "./seller-note.ts";

const YARD = "Preview Test Dealer (not a real dealership)";

function refuse(note: string, name = YARD): string {
  const reason = sellerNoteRefusal(note, name);
  assert.ok(reason, note);
  return reason;
}

test("a plain condition note is kept", () => {
  for (const note of ["", "Two keys", "Service books, two keys, small chip in windscreen.", "60,000 km, asking $35,200"]) {
    assert.equal(sellerNoteRefusal(note, YARD), null, note);
  }
});

test("a phone number is refused, in the forms a dealer would type", () => {
  for (const note of ["Ring 0412 345 678", "call 0412345678", "+61 412 345 678", "(02) 9876 5432", "1300 123 456"]) {
    assert.match(refuse(note), /phone number/);
    assert.match(refuse(note), /Buyers must not be able to tell who you are/);
  }
  assert.equal(refuse("+61 412 345 678").includes("ABN"), false);
});

test("an email, a web address, an ABN, the dealership name and a stock number are refused", () => {
  assert.match(refuse("Email pat@example.invalid"), /email address/);
  assert.match(refuse("See https://dealer.example/stock/1"), /web address/);
  assert.match(refuse("Listed at www.dealer.example"), /web address/);
  assert.match(refuse("Our site is dealer.com.au"), /web address/);
  assert.match(refuse("ABN 51 824 753 556"), /ABN/);
  assert.match(refuse("ABN 51824753556"), /ABN/);
  assert.equal(sellerNoteRefusal("ABN 51 824 753 556", YARD)?.includes("phone"), false);
  assert.match(refuse("Preview Test Dealer can deliver"), /dealership name/);
  assert.match(refuse("collected from preview test dealer"), /dealership name/);
  assert.match(refuse("Stock OC0123"), /stock number/);
  assert.match(refuse("rego plate on OC-0123"), /stock number/);
  assert.match(refuse("ours is oc 0123"), /stock number/);
});

test("several problems are named together", () => {
  const reason = refuse("Call 0412 345 678 or pat@example.invalid, stock OC0123");
  assert.match(reason, /phone number/);
  assert.match(reason, /email address/);
  assert.match(reason, /stock number/);
  assert.match(reason, / and /);
});

test("a short yard name is not treated as the dealership", () => {
  assert.equal(sellerNoteRefusal("Cam will call", "Cam"), null);
});
