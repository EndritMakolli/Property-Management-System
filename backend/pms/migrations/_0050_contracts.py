"""Default contract drafts, in Albanian and English.

Starting wording only. The operator edits these in place under Templates, so
nothing here is legal advice or a fixed clause set — it is a complete-enough
draft that the first edit is a change of wording rather than writing a contract
from a blank box.

Placeholders use the same syntax as the message templates: `(name)` is filled
from the reservation, and `[square brackets]` disappear when everything inside
them is empty. That way a stay with no deposit does not print an empty deposit
line, and staff learn one syntax rather than two.

One rule to know when editing: `render_template` resolves a line at a time, so
an optional [segment] must open and close on the same line. Split it over two
and it never matches - the line stays, and the placeholder inside is reported
missing instead.
"""

APARTMENT_EN = """SHORT-TERM ACCOMMODATION AGREEMENT

Between:
  The Host, (company name)[, business no. (company tax id)][, (company address)]
  and
  The Guest, (guest name)[, telephone (guest phone)][, email (guest email)]
  [ID / passport no. (guest id number)]

1. THE PROPERTY
   The Host lets to the Guest the furnished apartment (apartment)[, (apartment address)][, (apartment floor)],
   for accommodation purposes only.

2. PERIOD
   Arrival:   (check-in), from 14:00
   Departure: (check-out), by 11:00
   Total nights: (nights)
   Guests permitted: (guests)

3. PRICE AND PAYMENT
   The total price for the period is EUR (total price)[, that is EUR (nightly price) per night].
   Payment is due on arrival unless agreed otherwise in writing.
   [A refundable security deposit of EUR (deposit) is held against damage and returned within 7 days of departure, less the cost of any damage or missing items.]

4. USE OF THE PROPERTY
   The Guest agrees to:
   a) use the apartment quietly and respect the neighbours, with no noise between 22:00 and 08:00;
   b) not sublet, re-let or allow anyone not named in this agreement to stay overnight;
   c) not smoke inside the apartment, and not host parties or events;
   d) keep pets only where the Host has agreed in writing beforehand;
   e) return keys, access cards and the garage card, where issued, on departure.

5. CONDITION AND DAMAGE
   The apartment is handed over clean and in working order. The Guest reports any existing
   damage within 24 hours of arrival, and is otherwise responsible for damage caused during
   the stay, fair wear and tear excepted.

6. ACCESS
   The Host may enter the apartment in an emergency, and otherwise by prior agreement with
   the Guest.

7. CANCELLATION
   Cancellation is governed by the terms given at the time of booking.

8. TERMINATION
   The Host may end this agreement immediately, without refund for the remaining nights,
   if the Guest materially breaches clause 4.

9. DATA
   Identification details are collected only to meet the Host's legal obligation to
   register guests, and are not shared for any other purpose.

10. GOVERNING LAW
   This agreement is governed by the law of the Republic of Kosovo. The parties will try to
   settle any dispute amicably before going to court.

Signed on (today), in (company city).

The Host: ______________________        The Guest: ______________________
(company name)                          (guest name)
"""

APARTMENT_SQ = """KONTRATË PËR QIRA AFATSHKURTËR

Ndërmjet:
  Qiradhënësit, (company name)[, nr. biznesi (company tax id)][, (company address)]
  dhe
  Qiramarrësit, (guest name)[, telefon (guest phone)][, email (guest email)]
  [Nr. i letërnjoftimit / pasaportës (guest id number)]

1. OBJEKTI
   Qiradhënësi i jep me qira Qiramarrësit banesën e mobiluar (apartment)[, (apartment address)][, (apartment floor)],
   vetëm për qëllime banimi.

2. PERIUDHA
   Ardhja:   (check-in), prej orës 14:00
   Largimi:  (check-out), deri në orën 11:00
   Netë gjithsej: (nights)
   Numri i lejuar i personave: (guests)

3. ÇMIMI DHE PAGESA
   Çmimi i përgjithshëm për periudhën është (total price) EUR[, përkatësisht (nightly price) EUR për natë].
   Pagesa bëhet me rastin e ardhjes, përveç nëse është rënë dakord ndryshe me shkrim.
   [Depozita e kthyeshme prej (deposit) EUR mbahet për dëme dhe kthehet brenda 7 ditësh nga largimi, duke zbritur vlerën e dëmeve ose të sendeve që mungojnë.]

4. PËRDORIMI I BANESËS
   Qiramarrësi obligohet:
   a) ta përdorë banesën në qetësi dhe t'i respektojë fqinjët, pa zhurmë ndërmjet orës 22:00 dhe 08:00;
   b) të mos e japë banesën me nënqira dhe të mos lejojë të fjetë askush që nuk është i shënuar në këtë kontratë;
   c) të mos pijë duhan brenda banesës dhe të mos organizojë festa apo evenimente;
   d) të mbajë kafshë shtëpiake vetëm me pëlqim paraprak me shkrim të Qiradhënësit;
   e) t'i kthejë çelësat, kartelat e hyrjes dhe kartelën e garazhit, nëse janë dhënë, me rastin e largimit.

5. GJENDJA DHE DËMET
   Banesa dorëzohet e pastër dhe në gjendje të rregullt pune. Qiramarrësi njofton për çdo dëm
   ekzistues brenda 24 orësh nga ardhja dhe përndryshe përgjigjet për dëmet e shkaktuara gjatë
   qëndrimit, përveç konsumit të zakonshëm.

6. QASJA
   Qiradhënësi mund të hyjë në banesë në raste urgjente, dhe përndryshe me marrëveshje paraprake
   me Qiramarrësin.

7. ANULIMI
   Anulimi rregullohet sipas kushteve të dhëna në momentin e rezervimit.

8. NDËRPRERJA
   Qiradhënësi mund ta ndërpresë këtë kontratë menjëherë, pa kthim pagese për netët e mbetura,
   nëse Qiramarrësi shkel rëndë nenin 4.

9. TË DHËNAT
   Të dhënat identifikuese mblidhen vetëm për të përmbushur obligimin ligjor të Qiradhënësit
   për regjistrimin e mysafirëve dhe nuk ndahen për asnjë qëllim tjetër.

10. E DREJTA E ZBATUESHME
   Kjo kontratë rregullohet me ligjin e Republikës së Kosovës. Palët do të përpiqen ta zgjidhin
   çdo mosmarrëveshje me marrëveshje para se t'i drejtohen gjykatës.

Nënshkruar më (today), në (company city).

Qiradhënësi: ______________________     Qiramarrësi: ______________________
(company name)                          (guest name)
"""

VEHICLE_EN = """VEHICLE RENTAL AGREEMENT

Between:
  The Owner, (company name)[, business no. (company tax id)][, (company address)]
  and
  The Hirer, (guest name)[, telephone (guest phone)][, email (guest email)]
  [ID / passport no. (guest id number)]
  [Driving licence no. (licence number)]

1. THE VEHICLE
   The Owner hires to the Hirer the vehicle (vehicle)[, registration (registration)].
   [Odometer at handover: (odometer) km.]

2. PERIOD
   Collection: (check-in), from 09:00
   Return:     (check-out), by 18:00
   Total days: (nights)

3. PRICE AND PAYMENT
   The total price for the period is EUR (total price)[, that is EUR (nightly price) per day].
   Payment is due on collection unless agreed otherwise in writing.
   [A refundable security deposit of EUR (deposit) is held and returned within 7 days of return, less the cost of any damage, fines or missing fuel.]

4. WHO MAY DRIVE
   Only the Hirer may drive the vehicle, and only with a licence valid for the whole hire
   period. Any additional driver must be named in writing by the Owner before collection.

5. USE OF THE VEHICLE
   The Hirer agrees to:
   a) drive lawfully and never under the influence of alcohol, drugs or medication that impairs driving;
   b) not use the vehicle for racing, driving instruction, towing, or to carry goods for hire;
   c) not take the vehicle outside the Republic of Kosovo without the Owner's written consent;
   d) not sublet the vehicle or allow anyone not named above to drive it;
   e) not smoke inside the vehicle.

6. FUEL AND CONDITION
   The vehicle is handed over clean and with the fuel level recorded at collection, and is
   returned in the same condition and at the same fuel level. Refuelling by the Owner is
   charged at cost plus a service fee.

7. DAMAGE, FINES AND BREAKDOWN
   The Hirer is responsible for damage caused during the hire, and for every traffic fine or
   parking charge incurred during it, whenever it arrives. In the event of an accident the
   Hirer must inform the police and the Owner immediately and must not admit liability.

8. INSURANCE
   The vehicle carries the insurance required by law. Insurance does not cover damage caused
   while clause 5 is being breached, and in that case the Hirer bears the full cost.

9. RETURN AND LATE RETURN
   Late return is charged at the daily rate for each started day, unless the Owner has agreed
   an extension in writing.

10. TERMINATION
   The Owner may recover the vehicle immediately, without refund for the remaining days, if
   the Hirer materially breaches clauses 4 or 5.

11. GOVERNING LAW
   This agreement is governed by the law of the Republic of Kosovo. The parties will try to
   settle any dispute amicably before going to court.

Signed on (today), in (company city).

The Owner: ______________________       The Hirer: ______________________
(company name)                          (guest name)
"""

VEHICLE_SQ = """KONTRATË PËR QIRA TË AUTOMJETIT

Ndërmjet:
  Qiradhënësit, (company name)[, nr. biznesi (company tax id)][, (company address)]
  dhe
  Qiramarrësit, (guest name)[, telefon (guest phone)][, email (guest email)]
  [Nr. i letërnjoftimit / pasaportës (guest id number)]
  [Nr. i patentë shoferit (licence number)]

1. AUTOMJETI
   Qiradhënësi i jep me qira Qiramarrësit automjetin (vehicle)[, targa (registration)].
   [Kilometrazhi me rastin e dorëzimit: (odometer) km.]

2. PERIUDHA
   Marrja:  (check-in), prej orës 09:00
   Kthimi:  (check-out), deri në orën 18:00
   Ditë gjithsej: (nights)

3. ÇMIMI DHE PAGESA
   Çmimi i përgjithshëm për periudhën është (total price) EUR[, përkatësisht (nightly price) EUR në ditë].
   Pagesa bëhet me rastin e marrjes, përveç nëse është rënë dakord ndryshe me shkrim.
   [Depozita e kthyeshme prej (deposit) EUR mbahet dhe kthehet brenda 7 ditësh nga kthimi i automjetit, duke zbritur vlerën e dëmeve, gjobave ose karburantit që mungon.]

4. KUSH MUND TA DREJTOJË
   Automjetin mund ta drejtojë vetëm Qiramarrësi, dhe vetëm me patentë të vlefshme për tërë
   periudhën e qirasë. Çdo shofer shtesë duhet të shënohet me shkrim nga Qiradhënësi para marrjes.

5. PËRDORIMI I AUTOMJETIT
   Qiramarrësi obligohet:
   a) të ngasë në pajtim me ligjin dhe kurrë nën ndikimin e alkoolit, drogës apo barnave që e pengojnë ngasjen;
   b) të mos e përdorë automjetin për gara, mësim ngasjeje, tërheqje rimorkiosh apo transport mallrash me pagesë;
   c) të mos e nxjerrë automjetin jashtë Republikës së Kosovës pa pëlqim me shkrim të Qiradhënësit;
   d) të mos e japë automjetin me nënqira dhe të mos lejojë ta drejtojë askush që nuk është shënuar më lart;
   e) të mos pijë duhan brenda automjetit.

6. KARBURANTI DHE GJENDJA
   Automjeti dorëzohet i pastër dhe me nivelin e karburantit të shënuar me rastin e marrjes, dhe
   kthehet në të njëjtën gjendje dhe me të njëjtin nivel karburanti. Mbushja nga Qiradhënësi
   faturohet sipas kostos plus tarifa e shërbimit.

7. DËMET, GJOBAT DHE DEFEKTET
   Qiramarrësi përgjigjet për dëmet e shkaktuara gjatë qirasë, si dhe për çdo gjobë trafiku apo
   parkimi të krijuar gjatë saj, pavarësisht kur arrin. Në rast aksidenti, Qiramarrësi duhet ta
   njoftojë menjëherë policinë dhe Qiradhënësin dhe të mos pranojë përgjegjësi.

8. SIGURIMI
   Automjeti ka sigurimin e kërkuar me ligj. Sigurimi nuk mbulon dëmet e shkaktuara gjatë shkeljes
   së nenit 5, dhe në atë rast koston e plotë e bart Qiramarrësi.

9. KTHIMI DHE VONESA
   Kthimi me vonesë faturohet me tarifën ditore për çdo ditë të filluar, përveç nëse Qiradhënësi
   ka pranuar zgjatje me shkrim.

10. NDËRPRERJA
   Qiradhënësi mund ta marrë automjetin menjëherë, pa kthim pagese për ditët e mbetura, nëse
   Qiramarrësi shkel rëndë nenin 4 ose 5.

11. E DREJTA E ZBATUESHME
   Kjo kontratë rregullohet me ligjin e Republikës së Kosovës. Palët do të përpiqen ta zgjidhin
   çdo mosmarrëveshje me marrëveshje para se t'i drejtohen gjykatës.

Nënshkruar më (today), në (company city).

Qiradhënësi: ______________________     Qiramarrësi: ______________________
(company name)                          (guest name)
"""

CONTRACTS = [
    ("apartment", APARTMENT_SQ, APARTMENT_EN),
    ("vehicle", VEHICLE_SQ, VEHICLE_EN),
]
