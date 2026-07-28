export type ParsedCustomerEmailList = {
  emails: string[];
  nonEmptyLineCount: number;
  invalidLineNumbers: number[];
  duplicateEmails: string[];
};

const CUSTOMER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCustomerEmailList(value: unknown): ParsedCustomerEmailList {
  const emails: string[] = [];
  const invalidLineNumbers: number[] = [];
  const duplicateEmails: string[] = [];
  const seen = new Set<string>();
  let nonEmptyLineCount = 0;

  String(value || "")
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const email = rawLine.trim().toLowerCase();
      if (!email) return;

      nonEmptyLineCount += 1;
      if (email.length > 254 || !CUSTOMER_EMAIL_PATTERN.test(email)) {
        invalidLineNumbers.push(index + 1);
        return;
      }

      if (seen.has(email)) {
        duplicateEmails.push(email);
        return;
      }

      seen.add(email);
      emails.push(email);
    });

  return {
    emails,
    nonEmptyLineCount,
    invalidLineNumbers,
    duplicateEmails,
  };
}

export function hasValidCustomerEmailList(parsed: ParsedCustomerEmailList) {
  return (
    parsed.emails.length > 0 &&
    parsed.invalidLineNumbers.length === 0 &&
    parsed.duplicateEmails.length === 0 &&
    parsed.emails.length === parsed.nonEmptyLineCount
  );
}
