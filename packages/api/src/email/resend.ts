interface SendOrganizationInviteInput {
  to: string;
  organizationName: string;
  invitedByName: string;
  role: string;
  token: string;
}

function getAppUrl() {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!configured) {
    throw new Error("NEXT_PUBLIC_APP_URL or APP_URL is required for invites.");
  }

  return configured.replace(/\/$/, "");
}

export async function sendOrganizationInviteEmail(
  input: SendOrganizationInviteInput,
) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and RESEND_FROM are required for invites.");
  }

  const inviteUrl = `${getAppUrl()}/invites/${encodeURIComponent(input.token)}`;
  const subject = `${input.invitedByName} invited you to ${input.organizationName}`;
  const text = [
    `${input.invitedByName} invited you to join ${input.organizationName} as ${input.role}.`,
    "",
    `Accept the invite: ${inviteUrl}`,
    "",
    "This invite expires in 7 days.",
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Resend invite email failed with ${response.status}: ${body}`,
    );
  }
}
