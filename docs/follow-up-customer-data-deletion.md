# Follow-up: customer data deletion and anonymisation

Status: **open, needs an owner decision and possibly legal advice before it's built.** Recorded during the MAYTHA release (PR #76).

## The limitation

- Every order stores the customer's name and WhatsApp number (`orders.customer_name`, the WhatsApp contact columns) as part of an immutable snapshot.
- The `orders_mutation_rules` trigger (`enforce_order_mutation_rules`, migrations 0001 and 0022) rejects any change to those fields and any `DELETE` on `orders`. `order_status_history` and `admin_audit_events` are append-only.
- **Result:** a guest's request to delete or anonymise their order data **cannot be carried out from the app or the admin**. It would need a direct database change that the triggers refuse.
- **Accounts:** customer accounts can be deleted in the app (`CustomerAccountService.deleteAccount`). That removes the phone, name, addresses, favourites, sessions and order links. The orders themselves are kept as financial records, with the customer details they were placed with. Accounts are currently off in Production (0 accounts).
- **Admin assistant:** the AI assistant can process store records, including customer names; phones are masked by `maskPhone`. Its tool-run log stores redacted input summaries.

## What the privacy page promises today

Customers can ask, through the order's WhatsApp conversation, to see, correct or delete their data. The store deletes or de-identifies what it doesn't need to keep, and some order records may be kept for legal or accounting reasons. **No retention period is stated.**

## Decisions needed

1. **Retention period:** how long order records must be kept for accounting or legal purposes. After that, personal fields could be anonymised.
2. **Deletion requests within that period:** whether to refuse them (legal hold), or anonymise only the contact fields and keep the financial lines.
3. **Who handles requests:** an owner-only admin action with an audit event, versus a manual operator procedure.

## Suggested implementation (after the decisions)

- Write a migration that lets the trigger allow one explicit operation: replace `customer_name` and the WhatsApp fields with a fixed anonymised value. It must be callable only through an owner action, and must write an `admin_audit_events` row with a reason and no personal data.
- Run the same anonymisation in bulk for orders older than the agreed retention period.
- Add an admin page to look up an order by reference, anonymise it, and record the request date.
- Add tests: totals, items and status history are unchanged; personal fields are gone; the audit row exists; non-owners are refused.

## Related checks not verifiable from the code

- **Backups:** whether Production backups or point-in-time recovery contain personal data, and for how long they are kept. Deleted data stays in backups until they expire.
- **Hosting logs:** what personal data the hosting provider's logs hold. The app writes no order data to its own logs.
