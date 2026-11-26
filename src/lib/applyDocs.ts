// What the application form asks for: two different kinds of government photo ID and the credit score.

export const ID_TYPES = ["Driver's licence", 'Passport', 'Permanent resident card', 'Provincial photo ID card', 'Citizenship card', 'Other government ID'] as const;
export type IdType = (typeof ID_TYPES)[number];

/** Where the score is from: free services and banks show it with a soft check, which does not affect the score. */
export const CREDIT_SOURCES = ['Equifax', 'TransUnion', 'Borrowell', 'Credit Karma', 'My bank', 'Other'] as const;
export type CreditSource = (typeof CREDIT_SOURCES)[number];
