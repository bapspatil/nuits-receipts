from pathlib import Path
import base64

root = Path(__file__).parent
fixtures = {
    'holvi.csv': ('utf-8', 'Transaction ID;Booking Date;Amount;Currency;Payee;Reference;Original amount;Original currency\nholvi-fake-1;2026-09-01;-12,50;EUR;Synthetic Cloud;FI00 0000 0000 0000 00;;\nholvi-fake-2;02.09.2026;-18,42;EUR;Synthetic Foreign;INV-FAKE-2;-20,00;USD\n'),
    'nordea.csv': ('utf-8', 'Synthetic booked transactions\nKirjauspäivä;Saaja;Summa;Valuutta;Viite\n01.09.2026;Synthetic Kauppa;-1 234,56;EUR;FAKE-1\n02.09.2026;Synthetic Palautus;12,00;EUR;FAKE-2\nSynthetic footer\n'),
    'op.csv': ('cp1252', 'Kirjauspäivä;Saaja;Summa;Valuutta;Viite\n03.09.2026;Synthetic Päivätyö;-45,60;EUR;FI00 0000 0000 0000 00\n'),
    'revolut.csv': ('utf-8', 'Started Date,Completed Date,Description,Amount,Currency,ID,Fee\n2026-09-04 23:30:00+03:00,2026-09-05T00:01:02.123Z,"Synthetic, Coffee",-4.50,EUR,revolut-fake-1,0.00\n'),
    'wise.csv': ('utf-8', 'ID,Date,Amount,Currency,Description,Reference\nwise-fake-1,2026-09-05,-20.00,USD,Synthetic Software,FAKE-5\n'),
    'n26.csv': ('utf-8', 'Date,Payee,Payment reference,Amount (EUR),Currency\n2026-09-06,Synthetic Bakery,FAKE-6,-7.25,EUR\n'),
    'us.csv': ('utf-8', 'Date,Description,Debit,Credit\n03/04/2026,Synthetic Hardware,"1,234.56",\n03/05/2026,Synthetic Refund,,25.00\n'),
    'utf16le.csv': ('utf-16', 'Kirjauspäivä;Saaja;Summa;Valuutta;Viite\n07.09.2026;Synthetic Päivätyö;-8,90;EUR;FAKE-8\n'),
    'utf16be.csv': ('utf-16-be', '\ufeffKirjauspäivä;Saaja;Summa;Valuutta;Viite\n08.09.2026;Synthetic Päivätyö;-9,00;EUR;FAKE-9\n'),
}
for name, (encoding, text) in fixtures.items():
    data = text.encode(encoding)
    (root / name).write_bytes(data)
    if encoding != 'utf-8':
        (root / (name + '.b64')).write_text(base64.b64encode(data).decode() + '\n')
