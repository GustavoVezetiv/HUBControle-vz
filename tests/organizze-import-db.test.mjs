// Explicit local integration test; never connects to the configured Supabase.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readFileSync } from "node:fs";
const container = process.env.ORGANIZZE_TEST_CONTAINER;
const enabled = Boolean(container && /^hubvz-organizze-test-[a-z0-9-]+$/.test(container));
const database = `hubvz_test_${Date.now()}`;
const u = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const foreignCard = "33333333-3333-4333-8333-333333333333";
function sql(text, succeeds = true) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], { input: text, encoding: "utf8", windowsHide: true });
  if (succeeds) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0);
  return result.stdout.trim();
}
const quote = value => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const row = (key, target, values = {}, links = {}, tags = []) => ({ sourceKey: key, target, existingId: null, values, links, tags, reason: target === "source_only" ? "Origem conservada" : null, source: { key, sourceId: key.split(":").at(-1), entity: key.split(":")[0], raw: { id: Number(key.split(":").at(-1)), tags, recurrence_id: 88 }, sources: [{ task: { path: "/transactions" }, raw: { tags } }] } });
const rows = [
  row("category:1", "categories", { name: "Teste Casa", type: "expense", is_active: true }),
  row("category:2", "categories", { name: "Teste Mercado", type: "expense" }, { parent: "category:1" }),
  row("account:10", "source_only", {}),
  row("card:20", "credit_cards", { name: "Cartão sintético", closing_day: 10, due_day: 20 }),
  row("invoice:20:30", "credit_card_invoices", { reference_month: "2026-09-01", due_date: "2026-09-20", total_amount: 30, paid_amount: 30, status: "paid" }, { card: "card:20" }),
  row("transaction:100", "accounts_payable", { title: "Despesa sintética", amount: 12, due_date: "2026-09-01", status: "paid" }, { category: "category:2", account: "account:10" }, ["Mãe", "Histórico"]),
  row("transaction:101", "credit_card_transactions", { description: "Parcela sintética", amount: 30, transaction_date: "2026-09-01", installment_number: 2, installment_total: 3 }, { category: "category:2", card: "card:20", invoice: "invoice:20:30" }, ["Histórico"]),
  row("transaction:200", "source_only", { oppositeSourceKey: "transaction:201" }, { account: "account:10" }),
  row("transaction:201", "source_only", { oppositeSourceKey: "transaction:200" }, { account: "account:10" }),
  row("transaction:300", "source_only", {}, { paidInvoice: "invoice:20:30" }),
];
const call = value => `select public.confirm_organizze_import(${quote(value)},'{"start":"2023-01-01","end":"2026-10-22"}'::jsonb,'personal');`;
const asUser = text => `set role authenticated; select set_config('request.jwt.claim.sub','${u}',false); ${text}`;
test("Organizze local transaction: links, provenance, tags, idempotency, rollback and RLS", { skip: !enabled }, () => {
  const createdb = spawnSync("docker", ["exec", container, "createdb", "-U", "postgres", database], { encoding: "utf8", windowsHide: true });
  assert.equal(createdb.status, 0, createdb.stderr);
  sql(`create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (const migration of ["202605160001_initial_auth_schema_rls.sql", "202605200001_extend_foundation_crud_fields.sql", "202605200002_extend_cards_invoices_reimbursements.sql", "202605300001_link_accounts_to_installments.sql", "202606010001_recurring_credit_card_transactions.sql", "202606090001_fix_import_preview_persistence.sql", "20261022201515_organizze_confirm_import.sql"]) sql(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  sql(`grant usage on schema public to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated; insert into auth.users(id) values('${u}'),('${other}'); insert into public.credit_cards(id,user_id,name) values('${foreignCard}','${other}','Outro usuário'); insert into public.people(id,user_id,name) values('44444444-4444-4444-8444-444444444444','${u}','Pessoa sintética'); insert into public.reimbursements(id,user_id,person_id,expected_amount) values('55555555-5555-4555-8555-555555555555','${u}','44444444-4444-4444-8444-444444444444',50);`);
  const result = JSON.parse(sql(asUser(call(rows))).split("\n").at(-1));
  assert.equal(result.created, 6);
  assert.equal(result.sourceOnly, 4);
  assert.equal(sql(`select count(*) from public.accounts_payable`), "1");
  assert.equal(sql(`select count(*) from public.income_sources`), "0");
  assert.equal(sql(`select count(*) from public.credit_card_transactions t join public.credit_card_invoices i on i.id=t.invoice_id and i.credit_card_id=t.credit_card_id join public.categories c on c.id=t.category_id where t.installment_number=2 and t.installment_total=3 and not t.is_reimbursable and not t.is_recurring`), "1");
  assert.equal(sql(`select count(*) from public.categories child join public.categories parent on child.parent_category_id=parent.id`), "1");
  assert.equal(sql(`select count(*) from public.import_rows where mapped_data->'tags' ? 'Mãe' and mapped_data->>'source'='organizze'`), "1");
  assert.equal(sql(`select count(*) from public.import_rows where mapped_data->'resolved_links'->'account'->>'target'='source_only'`), "3");
  const retry = JSON.parse(sql(asUser(call(rows))).split("\n").at(-1));
  assert.equal(retry.created, 0); assert.equal(retry.reused, rows.length);
  assert.equal(sql(`select count(*) from public.accounts_payable`), "1");
  assert.equal(sql(`select count(*) from public.import_rows`), "10");
  const reimbursementBefore = sql(`select row_to_json(r)::text from public.reimbursements r`);
  const bad = [row("category:500", "categories", { name: "Rollback", type: "expense" }), row("transaction:501", "accounts_payable", { title: "Inválida", amount: -1, due_date: "2026-09-02", status: "pending" })];
  sql(asUser(call(bad)), false);
  assert.equal(sql(`select count(*) from public.categories where name='Rollback'`), "0");
  const hostile = row("card:999", "credit_cards", { name: "Vínculo alheio" }); hostile.existingId = foreignCard;
  sql(asUser(call([hostile])), false);
  sql(`insert into public.import_rows(user_id,import_batch_id,row_number,mapped_data,status,target_entity_type,target_entity_id) values('${u}','${result.batchId}',999,'{"source":"organizze","source_key":"card:998"}','skipped','credit_cards','${foreignCard}');`);
  sql(asUser(call([row("card:998", "credit_cards", { name: "Origem adulterada" })])), false);
  sql(`set role anon; ${call(rows)}`, false);
  sql(`set role authenticated; ${call(rows)}`, false);
  sql(asUser(call([row("transaction:998", "reimbursements", { expected_amount: 1 })])), false);
  assert.equal(sql(`select row_to_json(r)::text from public.reimbursements r`), reimbursementBefore);
  assert.equal(sql(asUser(`select count(*) from public.credit_cards where id='${foreignCard}';`)).split("\n").at(-1), "0");
});

test("reviewed reconciliation preserves manual IDs/links, promotes history, and blocks unclassified or duplicated writes", { skip: !enabled }, () => {
  sql(readFileSync(new URL("../supabase/migrations/20261022212106_organizze_reconciliation.sql", import.meta.url), "utf8"));
  const rpc = value => `select public.confirm_organizze_reconciliation(${quote(value)},'{"start":"2023-01-01","end":"2026-10-22"}'::jsonb);`;
  const reviewed = (value, action, ownership = null, personId = null, confirmDifferent = false) => ({ ...value, review: { action, ownership, personId, confirmDifferent } });
  const transaction = (id, target, amount, date = "2026-09-03", values = {}) => {
    const value = row(`transaction:${id}`, target, { amount: Math.abs(amount) / 100, ...values });
    value.source.raw.amount_cents = amount; value.source.raw.date = date;
    return value;
  };
  const card = JSON.parse(sql(`select row_to_json(t) from public.credit_card_transactions t limit 1`));
  const account = JSON.parse(sql(`select row_to_json(t) from public.accounts_payable t limit 1`));
  sql(`update public.credit_card_transactions set ownership_type='family',is_reimbursable=true,person_id='44444444-4444-4444-8444-444444444444' where id='${card.id}'; update public.reimbursements set credit_card_transaction_id='${card.id}',account_payable_id='${account.id}' where user_id='${u}';`);
  const fingerprint = () => sql(`select md5(jsonb_build_array((select jsonb_agg(to_jsonb(r) order by id) from public.reimbursements r),(select jsonb_agg(to_jsonb(t) order by id) from public.credit_card_transactions t),(select jsonb_agg(to_jsonb(i) order by id) from public.credit_card_invoices i),(select jsonb_agg(to_jsonb(a) order by id) from public.accounts_payable a),(select jsonb_agg(to_jsonb(i) order by id) from public.income_sources i))::text);`);
  const before = fingerprint();
  const batchCount = sql(`select count(*) from public.import_batches`);
  for (const invalidPeriod of ["null", "{}", '{"start":"2026-09-01"}', '{"start":"2026-09-30","end":"2026-09-01"}']) {
    sql(asUser(`select public.confirm_organizze_reconciliation(${quote([reviewed(transaction(799, "source_only", -1200), "historical")])},'${invalidPeriod}'::jsonb);`), false);
  }
  sql(asUser(`select public.confirm_organizze_reconciliation(null,'{"start":"2026-09-01","end":"2026-09-30"}'::jsonb);`), false);
  assert.equal(sql(`select count(*) from public.import_batches`), batchCount);
  assert.equal(fingerprint(), before);
  const historical = reviewed(transaction(800, "source_only", -1200), "historical");
  const pending = reviewed(transaction(800, "source_only", -1200), "pending");
  const history = JSON.parse(sql(asUser(rpc([pending]))).split("\n").at(-1));
  assert.equal(history.created, 0); assert.equal(history.sourceOnly, 1);
  const ledgerId = sql(`select id from public.import_rows where mapped_data->>'source_key'='transaction:800'`);
  assert.equal(sql(`select mapped_data->>'state' from public.import_rows where id='${ledgerId}'`), "pending");
  sql(asUser(rpc([historical])));
  assert.equal(sql(`select mapped_data->>'state' from public.import_rows where id='${ledgerId}'`), "historical");
  const linkedAccount = reviewed(transaction(800, "accounts_payable", -1200, "2026-09-03", { due_date: account.due_date, category_id: account.category_id, person_id: account.person_id }), "link"); linkedAccount.existingId = account.id;
  const linkedCard = reviewed(transaction(801, "credit_card_transactions", -3000, "2026-09-03", { transaction_date: card.transaction_date, credit_card_id: card.credit_card_id, invoice_id: card.invoice_id, category_id: card.category_id, person_id: "44444444-4444-4444-8444-444444444444", ownership_type: "family" }), "link"); linkedCard.existingId = card.id;
  const result = JSON.parse(sql(asUser(rpc([linkedAccount, linkedCard]))).split("\n").at(-1));
  assert.equal(result.created, 0); assert.equal(result.reused, 2);
  assert.equal(sql(`select id from public.import_rows where mapped_data->>'source_key'='transaction:800'`), ledgerId);
  assert.equal(sql(`select count(*) from public.import_rows where mapped_data->>'source_key'='transaction:800' and target_entity_id='${account.id}' and mapped_data->>'state'='reconciled'`), "1");
  assert.equal(fingerprint(), before);
  const unknown = reviewed(transaction(802, "accounts_payable", -1300, "2026-09-03", { title: "Sem titularidade", due_date: "2026-09-03", status: "paid" }), "new");
  sql(asUser(rpc([unknown])), false);
  const possibleDuplicate = reviewed(transaction(803, "accounts_payable", -1200, "2026-09-03", { title: "Descrição diferente", due_date: "2026-09-03", status: "paid" }), "new", "personal");
  sql(asUser(rpc([possibleDuplicate])), false);
  const rollbackCategory = reviewed(row("category:804", "categories", { name: "Reverter junto", type: "expense" }), "dependency");
  sql(asUser(rpc([rollbackCategory, unknown])), false);
  assert.equal(sql(`select count(*) from public.categories where name='Reverter junto'`), "0");
  assert.equal(fingerprint(), before);
  const foreignLink = structuredClone(linkedCard); foreignLink.sourceKey = "transaction:805"; foreignLink.source.key = foreignLink.sourceKey; foreignLink.existingId = foreignCard;
  sql(asUser(rpc([foreignLink])), false);
  assert.equal(sql(`select has_function_privilege('authenticated','public.confirm_organizze_import(jsonb,jsonb,text)','execute')`), "f");
  sql(`set role anon; ${rpc([historical])}`, false);
  // Explicitly approved new ownership/nature, no generated reimbursement.
  const income = reviewed(transaction(806, "income_sources", 1700, "2026-09-25", { name: "Entrada classificada", expected_date: "2026-09-25", received_date: "2026-09-25", status: "received", inflow_kind: "third_party_money" }), "new", "third_party");
  const untypedIncome = structuredClone(income); delete untypedIncome.values.inflow_kind;
  sql(asUser(rpc([untypedIncome])), false);
  assert.equal(JSON.parse(sql(asUser(rpc([income]))).split("\n").at(-1)).created, 1);
  assert.equal(sql(`select inflow_kind from public.income_sources where name='Entrada classificada'`), "third_party_money");
  const retry = JSON.parse(sql(asUser(rpc([income]))).split("\n").at(-1)); assert.equal(retry.created, 0); assert.equal(retry.reused, 1);
  const newCard = reviewed(row("card:901", "credit_cards", { name: "Cartão revisado sintético" }), "dependency");
  const newInvoice = reviewed(row("invoice:901:902", "credit_card_invoices", { reference_month: "2026-10-01", due_date: "2026-10-20", total_amount: 55, personal_amount: 0, reimbursable_amount: 15, third_party_amount: 40, paid_amount: 0, status: "open" }, { card: "card:901" }), "dependency");
  const family = reviewed(transaction(903, "credit_card_transactions", -4000, "2026-10-10", { description: "Compra familiar", transaction_date: "2026-10-10" }), "new", "family"); family.links = { card: "card:901", invoice: "invoice:901:902" };
  const reimbursable = reviewed(transaction(904, "credit_card_transactions", -1500, "2026-10-10", { description: "Compra reembolsável", transaction_date: "2026-10-10" }), "new", "reimbursable", "44444444-4444-4444-8444-444444444444"); reimbursable.links = { ...family.links };
  const cardResult = JSON.parse(sql(asUser(rpc([newCard, newInvoice, family, reimbursable]))).split("\n").at(-1));
  assert.equal(cardResult.created, 4);
  assert.equal(sql(`select count(*) from public.credit_card_transactions t join public.credit_card_invoices i on t.invoice_id=i.id and t.credit_card_id=i.credit_card_id where t.description='Compra familiar' and t.ownership_type='family' and i.total_amount=55 and i.paid_amount=0 and i.personal_amount=0 and i.third_party_amount=40 and i.reimbursable_amount=15`), "1");
  assert.equal(sql(`select count(*) from public.credit_card_transactions where description='Compra reembolsável' and ownership_type='reimbursable' and is_reimbursable and person_id='44444444-4444-4444-8444-444444444444'`), "1");
  sql(`insert into public.income_sources(id,user_id,name,amount,expected_date,received_date,inflow_kind,status,person_id) values('77777777-7777-4777-8777-777777777777','${u}','Recebimento manual',25,'2025-01-01','2026-09-20','reimbursement','received','44444444-4444-4444-8444-444444444444');`);
  const receipt = reviewed(transaction(905, "income_sources", 2500, "2026-09-21", { expected_date: "2025-01-01", received_date: "2026-09-20", inflow_kind: "reimbursement", person_id: "44444444-4444-4444-8444-444444444444", category_id: null }), "link"); receipt.existingId = "77777777-7777-4777-8777-777777777777";
  const receiptBefore = fingerprint();
  assert.equal(JSON.parse(sql(asUser(rpc([receipt]))).split("\n").at(-1)).created, 0);
  assert.equal(fingerprint(), receiptBefore);
  assert.equal(sql(`select count(*) from public.reimbursements`), "1");
});

test("Pluggy inbox reuses the ledger, converges with Organizze/manual canonical IDs and preserves every financial row", { skip: !enabled }, () => {
  sql(readFileSync(new URL("../supabase/migrations/20261023145056_pluggy_inbox_reconciliation.sql", import.meta.url), "utf8"));
  const uuid = number => `90000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const banks = ["nubank", "xp", "sicredi", "caixa", "mercado_pago"];
  const sources = banks.map((institution,index) => ({ sourceKey: `pluggy:${uuid(index + 1)}:${uuid(index + 101)}:${uuid(index + 201)}`, institution, itemId: uuid(index + 1), accountId: uuid(index + 101), accountType: "BANK", fetchedAt: "2026-10-23T12:00:00Z", raw: { id: uuid(index + 201), accountId: uuid(index + 101), description: "Fixture", amount: -12, date: "2026-09-03T00:00:00Z", status: "POSTED", type: "DEBIT", currencyCode: "BRL", providerId: `provider-${index}` }, categoryId: null, ownership: null, ruleIds: [], pending: true }));
  const call = rows => `select public.stage_pluggy_rows(${quote(rows)});`;
  const fingerprint = () => sql(`select md5(jsonb_build_array((select jsonb_agg(to_jsonb(r) order by id) from public.reimbursements r),(select jsonb_agg(to_jsonb(t) order by id) from public.credit_card_transactions t),(select jsonb_agg(to_jsonb(i) order by id) from public.credit_card_invoices i),(select jsonb_agg(to_jsonb(a) order by id) from public.accounts_payable a),(select jsonb_agg(to_jsonb(i) order by id) from public.income_sources i))::text);`);
  const original = fingerprint();
  assert.equal(JSON.parse(sql(asUser(call(sources))).split("\n").at(-1)).created, 5);
  assert.equal(JSON.parse(sql(asUser(call(sources))).split("\n").at(-1)).created, 0);
  assert.equal(sql(`select count(*) from public.import_rows where mapped_data->>'source'='pluggy'`), "5");
  assert.equal(sql(`select count(*) from public.import_rows where mapped_data->>'source'='pluggy' and target_entity_id is null and mapped_data->>'ownership' is null`), "5");
  const canonical = sql(`select target_entity_id from public.import_rows where mapped_data->>'source'='organizze' and mapped_data->>'source_key'='transaction:100'`);
  assert.ok(canonical);
  const source = sources[0];
  const version = () => sql(`select updated_at from public.import_rows where user_id='${u}' and mapped_data->>'source_key'='${source.sourceKey}'`);
  const review = { state: "reconciled", categoryId: null, ownership: null, targetId: canonical, target: "accounts_payable" };
  const doReview = (key, value, at) => `select public.review_pluggy_row('${key}',${quote(value)},'${at}'::timestamptz);`;
  const initialVersion = version();
  sql(asUser(doReview(source.sourceKey, review, initialVersion)));
  assert.equal(sql(`select target_entity_id from public.import_rows where mapped_data->>'source_key'='${source.sourceKey}'`), canonical);
  assert.equal(fingerprint(), original);
  sql(asUser(doReview(source.sourceKey, review, initialVersion)), false); // stale form
  sql(asUser(doReview(source.sourceKey, { ...review, state: "new", targetId: null, target: null }, version())), false); // cannot detach a canonical origin
  const originalRaw = sql(`select raw_data from public.import_rows where mapped_data->>'source_key'='${source.sourceKey}'`);
  const refreshed = sources.map(row => row === source ? { ...row, raw: { ...row.raw, amount: -13 }, ownership: "personal" } : row);
  sql(asUser(call(refreshed)));
  assert.equal(sql(`select raw_data from public.import_rows where mapped_data->>'source_key'='${source.sourceKey}'`), originalRaw);
  assert.equal(sql(`select mapped_data->>'ownership' from public.import_rows where mapped_data->>'source_key'='${source.sourceKey}'`), "");
  assert.equal(sql(`select target_entity_id from public.import_rows where mapped_data->>'source_key'='${source.sourceKey}'`), canonical);
  assert.equal(fingerprint(), original);
  sql(asUser(doReview(source.sourceKey, review, version())), false); // changed amount does not edit the canonical entry
  const otherSource = sources[1];
  const otherVersion = sql(`select updated_at from public.import_rows where mapped_data->>'source_key'='${otherSource.sourceKey}'`);
  sql(asUser(doReview(otherSource.sourceKey, { state: "own_transfer", categoryId: null, ownership: null }, otherVersion)));
  assert.equal(fingerprint(), original);
  const payment = { ...sources[2], raw: { ...sources[2].raw, operationType: "PAGAMENTO_FATURA" } };
  sql(asUser(call([payment])));
  const paymentVersion = sql(`select updated_at from public.import_rows where mapped_data->>'source_key'='${payment.sourceKey}'`);
  sql(asUser(doReview(payment.sourceKey, review, paymentVersion)), false);
  sql(asUser(doReview(payment.sourceKey, { state: "invoice_payment", categoryId: null, ownership: null }, paymentVersion)));
  sql(`set role anon; ${call(sources)}`, false);
  sql(`set role authenticated; ${call(sources)}`, false);
  sql(`set role authenticated; select set_config('request.jwt.claim.sub','${other}',false); ${doReview(source.sourceKey,review,version())}`, false);
  const category = sql(`select id from public.categories where user_id='${u}' and type='expense' order by id limit 1`);
  const rule = { pattern: "microsoft", categoryId: category, ownership: null, active: true };
  const ruleId = sql(asUser(`select public.save_pluggy_rule(${quote(rule)});`)).split("\n").at(-1);
  assert.equal(sql(`select mapping_config->>'ownership' from public.import_batches where id='${ruleId}'`), "");
  sql(asUser(`select public.save_pluggy_rule(${quote({ ...rule, id: ruleId, active: false })});`));
  assert.equal(sql(`select mapping_config->>'active' from public.import_batches where id='${ruleId}'`), "false");
  sql(asUser(`select public.save_pluggy_rule(${quote({ ...rule, categoryId: foreignCard })});`), false);
  assert.equal(fingerprint(), original);
});
