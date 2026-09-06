"""Contract drafts, second cut: terms only.

The first version typed the whole document into the template — a party block,
an address, a signature line, all as plain text. That made the printed contract
a wall of monospace, and it meant the operator maintained the company's own
address inside a template that already knew it.

So the split is now: the **document** provides the identity (logo, the two
parties, the stay summary, the signature lines) laid out like an invoice, and
the **template** provides the terms. Editing wording is still editing wording;
nobody has to retype an address to change a cancellation clause.

Placeholders still work here — a clause can name (apartment) or (total price) —
and an optional `[segment]` must still open and close on the same line.
"""

APARTMENT_EN = """1. THE PROPERTY
The Host lets the furnished apartment described above to the Guest, for accommodation purposes only. It is handed over clean and in working order.

2. ARRIVAL AND DEPARTURE
Arrival from 14:00 on (check-in). Departure by 11:00 on (check-out). No more than (guests) people may stay overnight.

3. PAYMENT
The total price for the period is EUR (total price), due on arrival unless agreed otherwise in writing.
[A refundable deposit of EUR (deposit) is held against damage and returned within 7 days of departure, less the cost of any damage or missing items.]

4. USE OF THE PROPERTY
The Guest agrees to:
a) use the apartment quietly and respect the neighbours, with no noise between 22:00 and 08:00;
b) not sublet or re-let it, and not allow anyone not named in this agreement to stay overnight;
c) not smoke inside the apartment, and not host parties or events;
d) keep pets only where the Host has agreed in writing beforehand;
e) return all keys, access cards and the garage card, where issued, on departure.

5. DAMAGE
The Guest reports any existing damage within 24 hours of arrival, and is otherwise responsible for damage caused during the stay, fair wear and tear excepted.

6. ACCESS
The Host may enter the apartment in an emergency, and otherwise only by prior agreement with the Guest.

7. CANCELLATION
Cancellation is governed by the terms given at the time of booking.

8. TERMINATION
The Host may end this agreement immediately, without refund for the remaining nights, if the Guest materially breaches clause 4.

9. DATA PROTECTION
Identification details are collected only to meet the Host's legal obligation to register guests, and are not shared for any other purpose.

10. GOVERNING LAW
This agreement is governed by the law of the Republic of Kosovo. The parties will try to settle any dispute amicably before going to court.
"""

APARTMENT_SQ = """1. OBJEKTI
Qiradhënësi ia jep me qira Qiramarrësit banesën e mobiluar të përshkruar më lart, vetëm për qëllime banimi. Ajo dorëzohet e pastër dhe në gjendje të rregullt pune.

2. ARDHJA DHE LARGIMI
Ardhja prej orës 14:00 më (check-in). Largimi deri në orën 11:00 më (check-out). Në banesë nuk mund të flenë më shumë se (guests) persona.

3. PAGESA
Çmimi i përgjithshëm për periudhën është (total price) EUR, i pagueshëm me rastin e ardhjes, përveç nëse është rënë dakord ndryshe me shkrim.
[Depozita e kthyeshme prej (deposit) EUR mbahet për dëme dhe kthehet brenda 7 ditësh nga largimi, duke zbritur vlerën e dëmeve ose të sendeve që mungojnë.]

4. PËRDORIMI I BANESËS
Qiramarrësi obligohet:
a) ta përdorë banesën në qetësi dhe t'i respektojë fqinjët, pa zhurmë ndërmjet orës 22:00 dhe 08:00;
b) të mos e japë me nënqira dhe të mos lejojë të flejë askush që nuk është i shënuar në këtë kontratë;
c) të mos pijë duhan brenda banesës dhe të mos organizojë festa apo evenimente;
d) të mbajë kafshë shtëpiake vetëm me pëlqim paraprak me shkrim të Qiradhënësit;
e) t'i kthejë të gjithë çelësat, kartelat e hyrjes dhe kartelën e garazhit, nëse janë dhënë, me rastin e largimit.

5. DËMET
Qiramarrësi njofton për çdo dëm ekzistues brenda 24 orësh nga ardhja dhe përndryshe përgjigjet për dëmet e shkaktuara gjatë qëndrimit, përveç konsumit të zakonshëm.

6. QASJA
Qiradhënësi mund të hyjë në banesë në raste urgjente, dhe përndryshe vetëm me marrëveshje paraprake me Qiramarrësin.

7. ANULIMI
Anulimi rregullohet sipas kushteve të dhëna në momentin e rezervimit.

8. NDËRPRERJA
Qiradhënësi mund ta ndërpresë këtë kontratë menjëherë, pa kthim pagese për netët e mbetura, nëse Qiramarrësi shkel rëndë nenin 4.

9. MBROJTJA E TË DHËNAVE
Të dhënat identifikuese mblidhen vetëm për të përmbushur obligimin ligjor të Qiradhënësit për regjistrimin e mysafirëve dhe nuk ndahen për asnjë qëllim tjetër.

10. E DREJTA E ZBATUESHME
Kjo kontratë rregullohet me ligjin e Republikës së Kosovës. Palët do të përpiqen ta zgjidhin çdo mosmarrëveshje me marrëveshje para se t'i drejtohen gjykatës.
"""

VEHICLE_EN = """1. THE VEHICLE
The Owner hires the vehicle described above to the Hirer. It is handed over clean, roadworthy and with the fuel level recorded at collection.

2. COLLECTION AND RETURN
Collection from 09:00 on (check-in). Return by 18:00 on (check-out). Late return is charged at the daily rate for each started day, unless the Owner has agreed an extension in writing.

3. PAYMENT
The total price for the period is EUR (total price), due on collection unless agreed otherwise in writing.
[A refundable deposit of EUR (deposit) is held and returned within 7 days of return, less the cost of any damage, fines or missing fuel.]

4. WHO MAY DRIVE
Only the Hirer may drive the vehicle, and only with a licence valid for the whole hire period. Any additional driver must be named in writing by the Owner before collection.

5. USE OF THE VEHICLE
The Hirer agrees to:
a) drive lawfully, and never under the influence of alcohol, drugs or medication that impairs driving;
b) not use the vehicle for racing, driving instruction, towing, or carrying goods for hire;
c) not take the vehicle outside the Republic of Kosovo without the Owner's written consent;
d) not sublet the vehicle or allow anyone not named above to drive it;
e) not smoke inside the vehicle.

6. FUEL AND CONDITION
The vehicle is returned in the same condition and at the same fuel level as at collection. Refuelling by the Owner is charged at cost plus a service fee.

7. DAMAGE, FINES AND ACCIDENTS
The Hirer is responsible for damage caused during the hire, and for every traffic fine or parking charge incurred during it, whenever it arrives. After an accident the Hirer must inform the police and the Owner immediately, and must not admit liability.

8. INSURANCE
The vehicle carries the insurance required by law. Insurance does not cover damage caused while clause 5 is being breached, and in that case the Hirer bears the full cost.

9. TERMINATION
The Owner may recover the vehicle immediately, without refund for the remaining days, if the Hirer materially breaches clause 4 or 5.

10. GOVERNING LAW
This agreement is governed by the law of the Republic of Kosovo. The parties will try to settle any dispute amicably before going to court.
"""

VEHICLE_SQ = """1. AUTOMJETI
Qiradhënësi ia jep me qira Qiramarrësit automjetin e përshkruar më lart. Ai dorëzohet i pastër, i aftë për qarkullim dhe me nivelin e karburantit të shënuar me rastin e marrjes.

2. MARRJA DHE KTHIMI
Marrja prej orës 09:00 më (check-in). Kthimi deri në orën 18:00 më (check-out). Kthimi me vonesë faturohet me tarifën ditore për çdo ditë të filluar, përveç nëse Qiradhënësi ka pranuar zgjatje me shkrim.

3. PAGESA
Çmimi i përgjithshëm për periudhën është (total price) EUR, i pagueshëm me rastin e marrjes, përveç nëse është rënë dakord ndryshe me shkrim.
[Depozita e kthyeshme prej (deposit) EUR mbahet dhe kthehet brenda 7 ditësh nga kthimi, duke zbritur vlerën e dëmeve, gjobave ose karburantit që mungon.]

4. KUSH MUND TA DREJTOJË
Automjetin mund ta drejtojë vetëm Qiramarrësi, dhe vetëm me patentë të vlefshme për tërë periudhën e qirasë. Çdo shofer shtesë duhet të shënohet me shkrim nga Qiradhënësi para marrjes.

5. PËRDORIMI I AUTOMJETIT
Qiramarrësi obligohet:
a) të ngasë në pajtim me ligjin dhe kurrë nën ndikimin e alkoolit, drogës apo barnave që e pengojnë ngasjen;
b) të mos e përdorë automjetin për gara, mësim ngasjeje, tërheqje rimorkiosh apo transport mallrash me pagesë;
c) të mos e nxjerrë automjetin jashtë Republikës së Kosovës pa pëlqim me shkrim të Qiradhënësit;
d) të mos e japë me nënqira dhe të mos lejojë ta drejtojë askush që nuk është shënuar më lart;
e) të mos pijë duhan brenda automjetit.

6. KARBURANTI DHE GJENDJA
Automjeti kthehet në të njëjtën gjendje dhe me të njëjtin nivel karburanti si me rastin e marrjes. Mbushja nga Qiradhënësi faturohet sipas kostos plus tarifa e shërbimit.

7. DËMET, GJOBAT DHE AKSIDENTET
Qiramarrësi përgjigjet për dëmet e shkaktuara gjatë qirasë, si dhe për çdo gjobë trafiku apo parkimi të krijuar gjatë saj, pavarësisht kur arrin. Pas një aksidenti, Qiramarrësi duhet ta njoftojë menjëherë policinë dhe Qiradhënësin dhe të mos pranojë përgjegjësi.

8. SIGURIMI
Automjeti ka sigurimin e kërkuar me ligj. Sigurimi nuk mbulon dëmet e shkaktuara gjatë shkeljes së nenit 5, dhe në atë rast koston e plotë e bart Qiramarrësi.

9. NDËRPRERJA
Qiradhënësi mund ta marrë automjetin menjëherë, pa kthim pagese për ditët e mbetura, nëse Qiramarrësi shkel rëndë nenin 4 ose 5.

10. E DREJTA E ZBATUESHME
Kjo kontratë rregullohet me ligjin e Republikës së Kosovës. Palët do të përpiqen ta zgjidhin çdo mosmarrëveshje me marrëveshje para se t'i drejtohen gjykatës.
"""

CONTRACTS = [
    ("apartment", APARTMENT_SQ, APARTMENT_EN),
    ("vehicle", VEHICLE_SQ, VEHICLE_EN),
]
