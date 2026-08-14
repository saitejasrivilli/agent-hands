import express from "express";
import { members, subAccounts, nextConfirmationNumber } from "./data.js";

// Deliberately "legacy": server-rendered HTML, table-based layout, no CSS
// classes/ids/data-testid on most controls. Accessible name comes only from
// <label for> / native semantics / visible text — forcing the automation to
// rely on accessibility-tree / text matching rather than test hooks, per the
// brief's "heterogeneous, often legacy surfaces" requirement (Section 1).

const app = express();
app.use(express.urlencoded({ extended: true }));

const layout = (title: string, body: string) => `
<html>
<head><title>${title}</title></head>
<body>
<table border="0" cellpadding="4" cellspacing="0" width="600">
<tr><td colspan="2"><h2>Member Services Console</h2></td></tr>
<tr><td colspan="2">${body}</td></tr>
</table>
</body>
</html>`;

app.get("/", (_req, res) => {
  res.send(
    layout(
      "Member Search",
      `
      <form method="GET" action="/member">
        <table border="0" cellpadding="4">
          <tr>
            <td><label for="memberIdInput">Member ID</label></td>
            <td><input type="text" id="memberIdInput" name="memberId" /></td>
          </tr>
          <tr>
            <td colspan="2"><input type="submit" value="Search" /></td>
          </tr>
        </table>
      </form>
      `
    )
  );
});

app.get("/member", (req, res) => {
  const memberId = String(req.query.memberId ?? "");
  const member = members[memberId];

  if (!member) {
    res.send(
      layout(
        "Member Not Found",
        `<p>No member found matching ID "${memberId}".</p><p><a href="/">Back to search</a></p>`
      )
    );
    return;
  }

  res.send(
    layout(
      `Member ${member.id}`,
      `
      <table border="1" cellpadding="4" cellspacing="0">
        <tr><td>Name</td><td>${member.name}</td></tr>
        <tr><td>Member ID</td><td>${member.id}</td></tr>
        <tr><td>Savings Balance</td><td>${member.savingsBalance.toFixed(2)} ${member.currency}</td></tr>
      </table>
      <p><a href="/member/${member.id}/new-subaccount">Open a new sub-account for this member</a></p>
      <p><a href="/">Back to search</a></p>
      `
    )
  );
});

app.get("/member/:id/new-subaccount", (req, res) => {
  const member = members[req.params.id];
  if (!member) {
    res.status(404).send(layout("Member Not Found", `<p>No such member.</p>`));
    return;
  }
  res.send(
    layout(
      "Open Sub-Account",
      `
      <p>Opening a new sub-account for ${member.name} (${member.id}).</p>
      <form method="POST" action="/member/${member.id}/new-subaccount">
        <table border="0" cellpadding="4">
          <tr>
            <td><label for="acctTypeInput">Account Type</label></td>
            <td>
              <select id="acctTypeInput" name="accountType">
                <option value="savings">Savings</option>
                <option value="checking">Checking</option>
              </select>
            </td>
          </tr>
          <tr>
            <td><label for="depositInput">Initial Deposit</label></td>
            <td><input type="text" id="depositInput" name="initialDeposit" /></td>
          </tr>
          <tr>
            <td colspan="2"><input type="submit" value="Continue" /></td>
          </tr>
        </table>
      </form>
      `
    )
  );
});

app.post("/member/:id/new-subaccount", (req, res) => {
  const member = members[req.params.id];
  if (!member) {
    res.status(404).send(layout("Member Not Found", `<p>No such member.</p>`));
    return;
  }
  const accountType = String(req.body.accountType ?? "savings");
  const initialDeposit = Number(req.body.initialDeposit ?? 0);

  const confirmationNumber = nextConfirmationNumber();
  subAccounts.push({ confirmationNumber, memberId: member.id, accountType, initialDeposit });

  res.send(
    layout(
      "Confirmation",
      `
      <p>Sub-account opened successfully.</p>
      <table border="1" cellpadding="4" cellspacing="0">
        <tr><td>Confirmation Number</td><td id="confirmationNumber">${confirmationNumber}</td></tr>
        <tr><td>Account Type</td><td>${accountType}</td></tr>
        <tr><td>Initial Deposit</td><td>${initialDeposit.toFixed(2)}</td></tr>
      </table>
      <p><a href="/">Back to search</a></p>
      `
    )
  );
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`target-app listening on http://localhost:${port}`);
});
