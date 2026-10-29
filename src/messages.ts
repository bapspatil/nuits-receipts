// Plain words for every message a person can see after a form is refused. The
// keys are the messages the code throws (InputError and requireInput take them
// as their first words); InputError looks the key up and shows the value, so
// the call sites stay short and the wording lives here. Second person, sentence
// case, one idea, and what to do next. test/messages.test.ts fails when src/
// throws a literal message that is in neither MESSAGES nor INTERNAL.
export const MESSAGES: Readonly<Record<string, string>> = {
  // accounts
  'Default account unavailable': "That account isn't available any more. Pick another account.",
  'Choose an account': 'Choose an account for this statement.',
  'Invalid account ID': "We couldn't find that account. Reload the page and try again.",
  'Account unavailable; preview again': "That account isn't available any more. Check the file again.",
  'Invalid new account ID': 'Something went wrong with the new account. Check the file again.',
  'Unsupported account currency': "That currency isn't supported. Pick one from the list.",
  'Account changed; preview again': 'That account changed since you checked the file. Check it again.',
  'Account label already exists': 'You already have an account with that name. Pick a different name.',
  'Account unavailable': "That account isn't available any more. Reload the page and try again.",
  'Transfer changed or unavailable; review both payments':
    'One of these payments changed. Look at both payments again before you link them.',
  'Transfer unavailable': "That transfer isn't there any more. Reload the page.",

  // package
  'Send already replaced':
    "You marked this month as sent again since, or it isn't marked as sent any more. There is nothing to undo.",

  // all
  'Choose a month like 2026-10': 'Choose a month like 2026-10.',

  // banking
  'Account label required': 'Give the account a name.',
  'Confirm supported account currency': 'Pick a currency from the list.',
  'Duplicate headers': 'Two columns in this file have the same name. Rename one in the file and try again.',
  'Preset bank and name require 1 to 100 characters': 'Give the bank and the layout a name of up to 100 characters.',
  'Built-in presets cannot be changed': "You can't change a built-in layout. Save your changes as a new layout.",
  'Preset revision required': 'Reload the page and try again.',
  'Preset changed. Preview and save again.':
    'This layout changed since you opened it. Check the file again, then save.',
  'Preset name already exists for this bank':
    'You already saved a layout with that name for this bank. Pick another name.',
  'Preset not found': "We couldn't find that layout.",
  'Stable bank ID has conflicting facts':
    'The bank gave two different payments the same ID. Check the file for repeated IDs.',
  'Fix CSV errors before import': 'Fix the problems listed above before you import.',
  'CSV too large': 'That file is too big. The limit is 2 MB.',
  'Spreadsheet unreadable': "We couldn't read that spreadsheet. Download it again from your bank.",
  'Spreadsheet password protected': 'That spreadsheet has a password. Save a copy without one.',
  'PDF statement unreadable':
    "We couldn't read payments from that PDF. Try again, or use your bank's XLSX or CSV download.",
  'PDF statement too long': 'That PDF is too long to read. Import it in parts, or use XLSX or CSV.',
  'PDF statement layout changed':
    "Some lines in that PDF don't fit the statement layout, so nothing was read. Use your bank's XLSX or CSV download.",
  'CSV requires 1 to 5000 rows': 'The file needs between 1 and 5,000 payments.',
  'Import must use one account': 'One file can only hold payments for one account.',
  'This file already belongs to another account': 'You already imported this file into a different account.',
  'Choose an existing account or create one': 'Choose an account, or fill in the details for a new one.',
  'Account is archived': 'That account was archived. Pick another account.',
  'Duplicate transaction ID within file':
    'The same transaction ID appears twice in this file. Remove the repeat and try again.',
  'Pending import has a frozen manifest. Replay the original settings.':
    "An earlier import of this file didn't finish. Import it again with the same settings.",
  'Confirm overlapping transactions before import':
    'Some payments look like ones you already imported. Say whether to skip them or import them anyway.',
  'Similar transactions exist in another account. Confirm account selection.':
    'Similar payments exist in another account. Tick the box to say this is the right account.',
  'Import snapshot exceeds 1 MiB': 'This file is too big to import in one go. Split it by month.',
  'Stored transaction has conflicting canonical facts. Import remains pending.':
    "A payment in this file doesn't match what you imported before. Nothing was changed.",
  'Overlapping transaction changed after preview. Import remains pending.':
    'Your payments changed while you were checking this file. Check it again.',
  'An overlapping import is still pending. Retry after it completes.':
    'Another import is still running. Wait a moment and try again.',
  'Stored import contains unexpected rows': "This import doesn't match what was saved before. Nothing was changed.",

  // csv
  'Invalid column index': 'Pick a column from the list.',
  'Direction labels required': 'Say which words in the file mean money in and which mean money out.',
  'Invalid direction label': "Those in or out words aren't valid. Use up to 100 characters for each.",
  'Mapping exceeds 32 KiB': 'These column settings are too long.',
  'Unsupported mapping version': 'These column settings are from an older version. Choose a layout again.',
  'Conflicting number separators': "The decimal mark and the thousands mark can't be the same.",
  'Debit and credit columns must differ': "Money in and money out can't be the same column.",
  'Conflicting direction labels': "The same word can't mean both money in and money out.",
  'Amount and direction columns must differ': "The amount and the in or out column can't be the same column.",
  'Invalid amount mode': 'Choose how the file shows amounts.',
  'Invalid currency mode': 'Choose how the file shows the currency.',
  'Invalid record range': 'Check the row numbers for the column names and the footer.',
  'CSV exceeds 2 MiB': 'That file is too big. The limit is 2 MB.',
  'Invalid bytes for selected encoding. Select Windows-1252 / ISO-8859-1 or BOM-less UTF-16 explicitly.':
    "We can't read this file with that text encoding. Try Windows-1252 or UTF-16 under File options.",
  'CSV contains invalid bytes or NULs': "This doesn't look like a text file. Export the statement as CSV again.",
  'CSV exceeds 100 columns': 'This file has more than 100 columns.',
  'CSV cell exceeds 64 KiB': 'One cell in this file is too long.',
  'Invalid header record': 'Check the row number of the column names.',
  'Date does not match selected format': "This date doesn't match the date format you chose.",
  'Time not permitted by mapping': 'There is a time here, but the settings expect only a date.',
  'Invalid time or offset': "This time isn't valid.",
  'Ambiguous amount separators': "We can't tell which mark is the decimal point in this amount.",
  'Multiple decimal separators': 'This amount has more than one decimal mark.',
  'Invalid thousands grouping': 'The thousands marks in this amount are in the wrong places.',
  'Debit and credit both blank': 'Both the money in and the money out cells are empty on this row.',
  'Invalid debit and credit': 'This row has an amount in both money in and money out.',
  'Unknown direction label': "This row's in or out word isn't one you listed.",
  'Amount sign conflicts with direction': "The sign of this amount doesn't match its in or out word.",
  'CSV raw row exceeds 256 KiB': 'One row in this file is too long.',
  'Merchant missing': "This row doesn't say who was paid.",
  'Original amount direction differs': 'The original amount has the opposite sign to the amount.',
  'Choose a column for every field the file needs': 'Choose a column for every field the file needs.',

  // batch
  'Invalid action': "That action isn't available here. Reload the page and try again.",
  'Invalid list': "We couldn't tell which list this was. Reload the page and try again.",
  'Invalid filter': "That filter isn't available. Reload the page and try again.",
  'Invalid progress': 'Something went wrong part way through. Reload the page and try again.',
  'Nothing matches the filter.': 'Nothing matches the filter any more. Reload the page.',
  'Choose where to move them': 'Choose Sales invoices or Receipts.',
  'Choose the day it was paid': 'Choose the day it was paid.',
  'Choose at least one': 'Select at least one row first.',
  'Invalid selection': "Something you selected isn't there any more. Reload the page and try again.",

  // discard
  'Invalid reason': 'Pick one of the reasons listed.',
  'Choose a receipt': 'Choose at least one receipt.',
  'Invalid receipt': "We couldn't find that receipt. Reload the page and try again.",
  'Receipt not found': "We couldn't find that receipt. It may have been removed.",
  'This receipt changed. Reload and try again.': 'This receipt changed since you opened it. Reload and try again.',
  'Remove the match first.':
    'This receipt is matched to a payment. Remove the match first, or choose Remove and discard.',
  'Invalid undo': "That undo link isn't valid any more.",

  // domain
  'Expected object': "Those settings aren't valid. Choose a layout again.",
  'Invalid ISO date': "That date isn't valid. Dates look like 2026-10-24.",
  'Unsupported currency': "That currency isn't supported. Pick one from the list.",
  'Invalid amount': "That amount isn't valid. Use numbers like 12.50 or 12,50.",
  'Sub-minor amount': 'That amount has too many decimal places.',
  'Unsafe amount': 'That amount is too large.',
  'Unsafe conversion': 'That amount is too large to convert.',
  'Invalid FX rate': "That exchange rate isn't valid.",

  // imports
  'Choose CSV': 'Choose a CSV file first.',
  'Read file before decoding': 'Something went wrong with the file. Choose it again.',
  'Invalid CSV preview data': 'We lost track of the file. Choose it again.',
  'Invalid preview settings': "Those settings aren't valid. Check the file again.",
  'Account not found': "We couldn't find that account.",
  'Invalid encoding': 'Pick a text encoding from the list.',
  'Preset is not available for these headers': "That layout doesn't fit this file's columns. Pick another layout.",
  'Invalid collision decision': 'Say whether to skip the payments you already imported or import them again.',
  'Preview expired or missing. Preview again.': 'The check ran out of time. Check the file again.',
  'Preview settings changed. Preview again.': 'The settings changed since you checked the file. Check it again.',
  'Mapping fields changed. Update preview before confirming.':
    'You changed the column settings. Choose Check again before you import.',
  'Import conflicts changed. Preview again.':
    'Your payments changed while you were checking this file. Check it again.',
  'Original amount and currency must both be mapped':
    'Choose both the original amount column and its currency column, or neither.',

  // index
  'Invalid form data': "We couldn't read what you sent. Reload the page and try again.",
  'Invalid email': "We couldn't find that email. Reload the page and try again.",
  'Invalid vendor rule': "Say what the seller's name contains. Each box takes up to 200 characters.",
  'Invalid rule category or priority':
    'Pick a part and a kind from the lists, and give the priority as a whole number.',
  'A rule with the same seller text already exists':
    'You already have a rule for that seller text. Edit that one instead.',
  'Origin does not match': 'That request came from another site, so we ignored it. Open the app and try again.',
  'Invalid page': "That page number isn't valid.",
  'No preview for this file type': "There's no preview for this kind of file. Download it instead.",
  'Source email not found': "We don't have the original email for this one.",
  'Original not found': "We can't find the original file. Upload it again if you have it.",
  'Invalid exemption': "We couldn't tell what to change. Reload the page and try again.",
  'Payment not found': "We couldn't find that payment. Reload the page and try again.",
  'Payment changed or belongs to an own-account transfer. Undo the pair first.':
    'This payment changed, or it is part of a transfer between your accounts. Undo the transfer first.',
  'Payment cannot be linked': "This payment can't be matched. It may already have a receipt, or it doesn't need one.",
  'Approve receipt before matching': 'Approve this receipt first. Only approved receipts can be matched.',
  'Money in can only be matched to an invoice you sent': 'Money coming in can only match an invoice you sent.',
  'A payment out needs a receipt, not a sales invoice': 'A payment going out needs a receipt, not an invoice you sent.',
  'Confirm match exceptions':
    "This receipt and payment don't line up exactly. Choose Match anyway if they belong together.",
  'Nothing to match': 'There is nothing to match here. Reload the page and try again.',
  'Pick a receipt from the list':
    'Pick one of the receipts in the list. Type a seller, a date or an amount to find it.',
  'More than one receipt fits that': 'More than one receipt fits that. Pick one from the list.',
  'Match changed. Reload.': 'This payment or receipt changed. Reload the page and try again.',
  'Receipt is already matched': 'That receipt is already matched to another payment.',
  'Vendor rule not found': "We couldn't find that rule. It may have been deleted.",
  'Not found': "We couldn't find that page.",
  'Choose a file': 'Choose a file to upload.',

  // presets
  'Original amount and currency columns must be paired':
    'Choose both the original amount column and its currency column, or neither.',
  'Map booking_date': 'Choose the column that holds the payment date.',
  'Map merchant': 'Choose the column that holds who was paid.',
  'Map amount or debit and credit': 'Choose the amount column, or both the money in and money out columns.',
  'Required mapping missing': 'Some column settings are missing. Choose a layout again.',

  // receipts
  'Empty request': 'Nothing was sent. Choose a file and try again.',
  'Input too large': 'That file is too big.',
  'Expected PDF, PNG, JPEG, or WebP': 'Upload a PDF, or a photo as PNG, JPEG or WebP.',
  'Document too large': 'That file is too big. PDFs can be up to 10 MB and photos up to 4 MB.',
  'File signature and media type differ': "That file isn't the kind it says it is. Upload the original PDF or photo.",
  'Attachment signature mismatch': "An attachment isn't the kind of file it says it is.",
  'Empty email': 'The email had no text and no attachments.',
  'Restore it first.': 'Restore this receipt first, then edit it.',
  'Stale receipt. Reload before saving.': 'This receipt changed since you opened it. Reload and try again.',
  'Field too long': 'One of the boxes has too much text. Shorten it.',
  'Invalid currency': 'Pick a currency from the list.',
  'Invalid VAT rate': 'Give the VAT rate as a percentage between 0 and 100, like 25.5.',
  'Invalid category': 'Pick a part and a kind from the lists.',
  'EUR override needs reason': 'You entered a euro amount. Say why in the box next to it.',
  'Cannot duplicate itself': "A receipt can't be a copy of itself.",
  'Duplicate chains are not allowed': 'That receipt is already a copy of another one. Pick the original instead.',
  'A duplicate parent cannot become a duplicate':
    "Other receipts are copies of this one, so it can't be a copy itself.",
  'Approval needs a reason': 'Write a short note for your accountant before you approve.',
  'Complete the client, date, currency and amounts before approval':
    'Fill in the client, date, currency, total, amount before VAT and VAT, then approve.',
  'Complete required facts before approval':
    'Fill in the seller, date, currency, total, amount before VAT and VAT, then approve.',
  'Country must be a two-letter code, like DE': 'Use a two-letter country code, like DE.',
  'Invalid VAT number': "That VAT number doesn't look right. Copy it as printed on the invoice, like DE123456789.",
  'Invalid VAT treatment': 'Pick how VAT was handled from the list.',
  'Invalid document kind': 'Pick receipts or invoices.',
  'It is already filed that way.': 'It is already filed that way.',
  'Only sales invoices can be marked paid': 'Only invoices you sent can be marked as paid.',
  'Note too long': 'Shorten the note to 300 characters.',
  'Say how it was paid, for example "Stripe payout 14 Oct"': 'Say how it was paid, for example "Stripe payout 14 Oct".',

  // setup
  'Invalid parts of the business': 'Something went wrong with the list of parts. Reload the page and try again.',
  'Keep at least one part of the business': 'Keep at least one part of the business.',
  'Unknown settings group': 'Reload the page and try again.',
  'Reload the page and try again': 'Reload the page and try again.',
  'Unknown setting': "We don't know that setting. Reload the page and try again.",

  // settings
  'Choose a supported currency': 'Choose a supported currency.',

  // ui
  'Invalid month': 'Choose a month like 2026-10.',

  // Written as plain copy where they are thrown (sign-in, mail, the month package).
  'Enter one email address, like billing@example.com': 'Enter one email address, like billing@example.com.',
  'That sender is approved. Remove it from approved senders in Settings first.':
    'That sender is approved. Remove it from approved senders in Settings first.',
  'That email is gone already.': 'That email is gone already.',
  'That sender is not on the list.': 'That sender is not on the list.',
  'Your Microsoft sign-in has expired or was revoked. Reconnect it in Settings, then try again.':
    'Your Microsoft sign-in has expired or was revoked. Reconnect it in Settings, then try again.',
  'OneDrive upload is not set up': 'OneDrive upload is not set up.',
  'Microsoft did not complete the sign-in. Start again from Settings.':
    'Microsoft did not complete the sign-in. Start again from Settings.',
  'This sign-in link expired or was opened in another browser. Start again from Settings.':
    'This sign-in link expired or was opened in another browser. Start again from Settings.',
  'Microsoft did not send a sign-in code. Start again from Settings.':
    'Microsoft did not send a sign-in code. Start again from Settings.',
  "Microsoft didn't accept the sign-in. Check that the redirect URI shown in Settings is added to the app in Microsoft Entra, and that MS_CLIENT_SECRET is current.":
    "Microsoft didn't accept the sign-in. Check that the redirect URI shown in Settings is added to the app in Microsoft Entra, and that MS_CLIENT_SECRET is current.",
  'Microsoft did not allow offline access. Make sure the app asks for offline_access, then connect again.':
    'Microsoft did not allow offline access. Make sure the app asks for offline_access, then connect again.',
  'Microsoft signed you in but would not say who you are. Try connecting again.':
    'Microsoft signed you in but would not say who you are. Try connecting again.',
  'That link opens a file, not a folder. In OneDrive, share the folder itself and paste that link.':
    'That link opens a file, not a folder. In OneDrive, share the folder itself and paste that link.',
  "Microsoft didn't say where that folder lives. Open the link once in your browser while signed in, then try again.":
    "Microsoft didn't say where that folder lives. Open the link once in your browser while signed in, then try again.",
  'Paste the full folder link, starting with https://': 'Paste the full folder link, starting with https://',
  'More than one shared folder has that name. Paste the link to the exact folder instead.':
    'More than one shared folder has that name. Paste the link to the exact folder instead.',
  'Connect your Microsoft account first.': 'Connect your Microsoft account first.',
  'Microsoft refused the upload. Your account needs edit rights on the folder; ask its owner. Files already uploaded are kept.':
    'Microsoft refused the upload. Your account needs edit rights on the folder; ask its owner. Files already uploaded are kept.',
  'The destination folder is gone. Choose it again in Settings.':
    'The destination folder is gone. Choose it again in Settings.',
  "The folder's OneDrive is full.": "The folder's OneDrive is full.",
  'OneDrive did not start the upload. Try again.': 'OneDrive did not start the upload. Try again.',
  'OneDrive did not finish the upload. Try again.': 'OneDrive did not finish the upload. Try again.',
  'Choose the destination folder in Settings first.': 'Choose the destination folder in Settings first.',
  'Nothing has changed since you sent this month.': 'Nothing has changed since you sent this month.',
  "You haven't marked this month as sent yet, so there is nothing to compare with.":
    "You haven't marked this month as sent yet, so there is nothing to compare with.",
  'There are no receipts to put in the package for this month.':
    'There are no receipts to put in the package for this month.',
  'There are no receipts dated in this month to send.': 'There are no receipts dated in this month to send.',
  'This month changed since you opened the page. Reload it, check what you send, then mark it as sent.':
    'This month changed since you opened the page. Reload it, check what you send, then mark it as sent.',
  'Settings were changed in another tab or by someone else. Reload and try again.':
    'Settings were changed in another tab or by someone else. Reload and try again.',
};

// Messages a person never sees: AI answer validation (a refused answer becomes
// a review flag, never a page), exchange-rate lookups (a failed lookup leaves
// the euro amount blank), and checks that an earlier check already caught.
// Add to this list only with a reason.
export const INTERNAL: readonly string[] = [
  'Invalid reference columns',
  'Invalid extraction envelope',
  'Invalid usage',
  'Invalid descriptions',
  'Invalid probabilities',
  'Choice is not highest probability',
  'Uncertain category',
  'Live AI binding unavailable',
  'FX unavailable',
  'Invalid FX response',
  'No historical FX',
  'Mapping fields changed',
  'Method not allowed',
];

// The plain words for a thrown message, or the message itself when it has none.
export function plain(message: string): string {
  return Object.hasOwn(MESSAGES, message) ? MESSAGES[message]! : message;
}
