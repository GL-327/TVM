/**
 * The terms, and the version somebody agreed to.
 *
 * Text and version live together and are served from one endpoint, so the
 * version recorded against an account is always the version that account was
 * actually shown. Keeping the wording in the interface and the number in the
 * core would let the two drift, and an acceptance record that points at
 * wording nobody can reproduce is worth nothing.
 *
 * On drafting: these are written to be read. Terms that are buried, dense or
 * sprung on someone at the last moment are the ones a court strikes out —
 * under the Consumer Rights Act 2015 a term must be transparent and
 * prominent to bind a consumer at all, and s.62 voids anything unfair. Hiding
 * a clause is therefore the most reliable way to lose it. Everything here is
 * stated plainly and shown before the account can be used.
 *
 * Some things cannot be excluded however they are written: liability for
 * death or personal injury caused by negligence, for fraud, and a consumer's
 * statutory rights. Clauses attempting it are void, so none is attempted, and
 * the text says so rather than implying a protection that does not exist.
 *
 * This is not legal advice and was not written by a lawyer. Anyone running
 * this for real should have one read it.
 */

export const TERMS_VERSION = '2026-09-15';

export interface TermsSection {
  heading: string;
  /** Each entry is a paragraph. */
  body: string[];
}

export interface TermsDocument {
  version: TermsVersion;
  updated: string;
  intro: string[];
  sections: TermsSection[];
}

export type TermsVersion = typeof TERMS_VERSION;

export const TERMS: TermsDocument = {
  version: TERMS_VERSION,
  updated: '15 September 2026',
  intro: [
    'These terms are a contract between you and the person who runs this copy of TVM ("the operator"). You have to agree to them before your account can be used. Please read them — they are short on purpose.',
    'The short version: TVM is a player. It does not come with anything to watch. Whatever you connect it to is yours, and so is the responsibility for having the right to use it.',
  ],
  sections: [
    {
      heading: '1. What TVM is, and what it is not',
      body: [
        'TVM is software for organising and playing video from sources you supply — your own files, your own Real-Debrid account, your own IPTV subscription.',
        'TVM does not host, supply, licence, index or provide any film, programme or channel. No content of any kind comes with it. Every stream it plays comes from a service you have connected and are responsible for.',
        'The operator is not a broadcaster, a content provider, or a party to any arrangement between you and whoever supplies what you watch.',
      ],
    },
    {
      heading: '2. Your account',
      body: [
        'Accounts are created by request and switched on by the operator. Creating one does not entitle you to access, and the operator may decline, suspend or remove any account at any time, with or without a reason.',
        'Keep your password to yourself. You are responsible for what happens under your account. Tell the operator promptly if you think someone else has got into it.',
        'One account is for one person. Sharing credentials is grounds for suspension.',
      ],
    },
    {
      heading: '3. What you must not do',
      body: [
        'Do not connect TVM to any source you are not legally entitled to access. That includes subscription services you do not hold a subscription to, and any service that is itself redistributing content without permission.',
        'Do not use TVM to copy, record, rebroadcast, resell or otherwise redistribute anything you play through it.',
        'Do not use TVM to break the law, to infringe anyone\'s copyright, or in a way that would put the operator in breach of any agreement or law.',
        'You confirm that you have the rights you need for everything you connect. If you do not, stop using TVM.',
      ],
    },
    {
      heading: '4. Charges',
      body: [
        'Access is arranged directly with the operator. Prices shown in the app are indicative of what access costs; nothing is sold or charged inside the app itself.',
        'Where money does change hands, it is for access to this software and the operator\'s time in running it. It is not payment for content, and it does not purchase any licence to any programme or channel.',
        'If you are a consumer, nothing in these terms affects your statutory rights, including your right to cancel a distance contract within 14 days where that right applies.',
      ],
    },
    {
      heading: '5. Donations',
      body: [
        'The donate button is a gift to the operator. It is entirely optional.',
        'A donation buys nothing. It does not create an account, activate one, upgrade one, extend one, or give you anything at all. Nothing in the app changes because you donated.',
        'Donations are not refundable, because nothing was sold. If you want access, ask the operator — do not donate and expect it.',
      ],
    },
    {
      heading: '6. No warranty',
      body: [
        'TVM is provided as it is. The operator does not promise it will work, keep working, be available, be free of faults, or be fit for anything in particular.',
        'It may stop at any time, permanently and without notice. Sources you connect may stop working, change, or disappear, and that is outside the operator\'s control entirely.',
        'Nothing here overrides rights you have as a consumer under the Consumer Rights Act 2015. Where that Act gives you a right, you keep it.',
      ],
    },
    {
      heading: '7. Liability',
      body: [
        'To the fullest extent the law allows, the operator is not liable for any indirect or consequential loss, for lost data, for lost profit, or for anything arising from what you chose to connect TVM to or what you did with it.',
        'Where the operator is liable, that liability is limited to the total amount you paid the operator in the twelve months before the claim, or £100 if that is greater.',
        'Some liability cannot be excluded by anyone, whatever a contract says: death or personal injury caused by negligence, fraud or fraudulent misrepresentation, and a consumer\'s statutory rights. None of it is excluded here, because it cannot be.',
      ],
    },
    {
      heading: '8. You cover the operator for your own misuse',
      body: [
        'If someone brings a claim against the operator because of what you connected TVM to, or what you did with it, you agree to cover the operator\'s reasonable costs and losses arising from that claim.',
        'This does not apply where the claim is the operator\'s own fault, and it does not apply to anything the law does not allow to be passed on.',
      ],
    },
    {
      heading: '9. Your data',
      body: [
        'To run an account the operator stores your email address, a display name, a one-way digest of your password, when you signed up, when you last signed in, how many times you have signed in, and which kind of device you last used.',
        'Your password itself is not stored and cannot be recovered by anyone, including the operator. It is kept as a salted scrypt digest, which only allows checking a password, never reading one.',
        'The operator is the data controller. You can ask what is held about you, ask for it to be corrected, or ask for your account and its data to be deleted. Ask the operator, who will action it.',
        'What you watch is not sent anywhere by TVM. Playback happens between your device and whatever source you connected.',
      ],
    },
    {
      heading: '10. Ending it',
      body: [
        'You can stop using TVM whenever you like and ask for your account to be deleted.',
        'The operator can suspend or end your access at any time, particularly for anything in section 3.',
        'Sections 3, 6, 7, 8 and 9 continue to apply after your account ends.',
      ],
    },
    {
      heading: '11. Law',
      body: [
        'These terms are governed by the law of England and Wales, and the courts of England and Wales have jurisdiction.',
        'If you live elsewhere in the UK, you may bring proceedings in your own courts, and you keep the consumer protections of where you live.',
        'If any part of these terms turns out to be unenforceable, the rest still applies.',
      ],
    },
    {
      heading: '12. Changes',
      body: [
        'The operator may update these terms. When that happens you will be asked to agree again before continuing, and the date at the top will change.',
        'Carrying on using TVM after agreeing to a new version means the new version applies.',
      ],
    },
  ],
};

/** The one-line summary shown beside the accept control. */
export const TERMS_SUMMARY =
  'TVM is a player and supplies no content. You are responsible for the sources you connect and for having the right to use them.';
