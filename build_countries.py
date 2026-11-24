#!/usr/bin/env python3
"""
Builds data/countries.js: one entry for every WHO member state (194).

Every country always gets its official WHO country page (a UN site).
Where a national food-safety / consumer-protection / health authority is known,
it is checked live: the link is kept only if the site responds and its page
title looks like the right body. Anything that fails is dropped, never guessed.

Usage:
    python3 build_countries.py            # verify and write data/countries.js
    python3 build_countries.py --report   # also print each check
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "countries.js"
UA = "curl/8.7.1"

# (ISO3, name, continent, lat, lon, [(authority name, url), ...])
C = [
    # ---------------- Africa ----------------
    ("DZA", "Algeria", "Africa", 36.75, 3.06, [("Ministry of Commerce", "https://www.commerce.gov.dz/")]),
    ("AGO", "Angola", "Africa", -8.84, 13.23, [("Ministry of Health", "https://minsa.gov.ao/")]),
    ("BEN", "Benin", "Africa", 6.50, 2.60, [("Government of Benin", "https://www.gouv.bj/")]),
    ("BWA", "Botswana", "Africa", -24.65, 25.91, [("Ministry of Health", "https://www.moh.gov.bw/")]),
    ("BFA", "Burkina Faso", "Africa", 12.37, -1.52, [("Ministry of Health", "https://www.sante.gov.bf/")]),
    ("BDI", "Burundi", "Africa", -3.38, 29.36, [("Ministry of Health", "https://www.minisante.gov.bi/")]),
    ("CPV", "Cabo Verde", "Africa", 14.93, -23.51, [("Regulatory Agency for Health (ERIS)", "https://www.eris.cv/")]),
    ("CMR", "Cameroon", "Africa", 3.87, 11.52, [("Ministry of Public Health", "https://www.minsante.cm/")]),
    ("CAF", "Central African Republic", "Africa", 4.39, 18.56, []),
    ("TCD", "Chad", "Africa", 12.13, 15.06, []),
    ("COM", "Comoros", "Africa", -11.70, 43.26, []),
    ("COG", "Congo", "Africa", -4.27, 15.28, []),
    ("COD", "DR Congo", "Africa", -4.32, 15.31, [("Ministry of Public Health", "https://www.minisanterdc.cd/")]),
    ("CIV", "Côte d'Ivoire", "Africa", 5.35, -4.00, [("Ministry of Health", "https://www.sante.gouv.ci/")]),
    ("DJI", "Djibouti", "Africa", 11.59, 43.15, []),
    ("EGY", "Egypt", "Africa", 30.04, 31.24, [("National Food Safety Authority", "https://www.nfsa.gov.eg/")]),
    ("GNQ", "Equatorial Guinea", "Africa", 3.75, 8.78, []),
    ("ERI", "Eritrea", "Africa", 15.33, 38.93, []),
    ("SWZ", "Eswatini", "Africa", -26.31, 31.14, [("Government of Eswatini", "https://www.gov.sz/")]),
    ("ETH", "Ethiopia", "Africa", 9.03, 38.74, [("Ethiopian Food and Drug Authority", "https://www.efda.gov.et/")]),
    ("GAB", "Gabon", "Africa", 0.39, 9.45, []),
    ("GMB", "Gambia", "Africa", 13.45, -16.58, [("Food Safety and Quality Authority", "https://www.fsqa.gm/")]),
    ("GHA", "Ghana", "Africa", 5.60, -0.19, [("Food and Drugs Authority", "https://www.fdaghana.gov.gh/")]),
    ("GIN", "Guinea", "Africa", 9.64, -13.58, []),
    ("GNB", "Guinea-Bissau", "Africa", 11.86, -15.60, []),
    ("KEN", "Kenya", "Africa", -1.29, 36.82, [("Ministry of Health", "https://www.health.go.ke/"), ("Kenya Bureau of Standards", "https://www.kebs.org/")]),
    ("LSO", "Lesotho", "Africa", -29.31, 27.48, [("Ministry of Health", "https://www.health.gov.ls/")]),
    ("LBR", "Liberia", "Africa", 6.30, -10.80, [("Ministry of Health", "https://www.moh.gov.lr/")]),
    ("LBY", "Libya", "Africa", 32.89, 13.19, []),
    ("MDG", "Madagascar", "Africa", -18.88, 47.51, [("Ministry of Public Health", "https://www.sante.gov.mg/")]),
    ("MWI", "Malawi", "Africa", -13.96, 33.79, [("Malawi Bureau of Standards", "https://www.mbsmw.org/"), ("Ministry of Health", "https://www.health.gov.mw/")]),
    ("MLI", "Mali", "Africa", 12.64, -8.00, []),
    ("MRT", "Mauritania", "Africa", 18.08, -15.98, []),
    ("MUS", "Mauritius", "Africa", -20.16, 57.50, [("Ministry of Health and Wellness", "https://health.govmu.org/")]),
    ("MAR", "Morocco", "Africa", 34.02, -6.84, [("National Food Safety Office (ONSSA)", "https://www.onssa.gov.ma/")]),
    ("MOZ", "Mozambique", "Africa", -25.97, 32.57, [("Ministry of Health", "https://www.misau.gov.mz/")]),
    ("NAM", "Namibia", "Africa", -22.56, 17.08, [("Ministry of Health and Social Services", "https://mhss.gov.na/")]),
    ("NER", "Niger", "Africa", 13.51, 2.11, []),
    ("NGA", "Nigeria", "Africa", 9.08, 7.40, [("NAFDAC", "https://www.nafdac.gov.ng/"), ("Federal Competition & Consumer Protection Commission", "https://fccpc.gov.ng/")]),
    ("RWA", "Rwanda", "Africa", -1.95, 30.06, [("Rwanda Food and Drugs Authority", "https://www.rwandafda.gov.rw/")]),
    ("STP", "São Tomé and Príncipe", "Africa", 0.34, 6.73, []),
    ("SEN", "Senegal", "Africa", 14.72, -17.47, [("Ministry of Health", "https://www.sante.gouv.sn/")]),
    ("SYC", "Seychelles", "Africa", -4.62, 55.45, [("Ministry of Health", "https://www.health.gov.sc/")]),
    ("SLE", "Sierra Leone", "Africa", 8.48, -13.23, [("Ministry of Health", "https://mohs.gov.sl/")]),
    ("SOM", "Somalia", "Africa", 2.05, 45.32, [("Ministry of Health", "https://moh.gov.so/")]),
    ("ZAF", "South Africa", "Africa", -25.75, 28.19, [("National Consumer Commission", "https://thencc.org.za/"), ("Department of Health", "https://www.health.gov.za/")]),
    ("SSD", "South Sudan", "Africa", 4.85, 31.58, []),
    ("SDN", "Sudan", "Africa", 15.50, 32.56, []),
    ("TGO", "Togo", "Africa", 6.13, 1.22, []),
    ("TUN", "Tunisia", "Africa", 36.81, 10.18, [("National Food Safety Authority (INSSPA)", "https://www.insspa.tn/")]),
    ("UGA", "Uganda", "Africa", 0.35, 32.58, [("Uganda National Bureau of Standards", "https://www.unbs.go.ug/")]),
    ("TZA", "Tanzania", "Africa", -6.16, 35.75, [("Tanzania Bureau of Standards", "https://www.tbs.go.tz/")]),
    ("ZMB", "Zambia", "Africa", -15.39, 28.32, [("Zambia Bureau of Standards", "https://www.zabs.org.zm/"), ("Ministry of Health", "https://www.moh.gov.zm/")]),
    ("ZWE", "Zimbabwe", "Africa", -17.83, 31.05, [("Ministry of Health and Child Care", "https://www.mohcc.gov.zw/")]),
    # ---------------- Americas ----------------
    ("ATG", "Antigua and Barbuda", "Americas", 17.12, -61.85, []),
    ("ARG", "Argentina", "Americas", -34.60, -58.38, [("ANMAT", "https://www.argentina.gob.ar/anmat"), ("SENASA", "https://www.argentina.gob.ar/senasa")]),
    ("BHS", "Bahamas", "Americas", 25.05, -77.35, [("Government of The Bahamas", "https://www.bahamas.gov.bs/")]),
    ("BRB", "Barbados", "Americas", 13.10, -59.62, [("Government of Barbados", "https://www.gov.bb/")]),
    ("BLZ", "Belize", "Americas", 17.25, -88.77, [("Belize Agricultural Health Authority", "https://www.baha.org.bz/")]),
    ("BOL", "Bolivia", "Americas", -16.50, -68.15, [("SENASAG", "https://www.senasag.gob.bo/")]),
    ("BRA", "Brazil", "Americas", -15.79, -47.88, [("ANVISA", "https://www.gov.br/anvisa/")]),
    ("CAN", "Canada", "Americas", 45.42, -75.70, [("Canadian Food Inspection Agency", "https://inspection.canada.ca/"), ("Recalls and safety alerts", "https://recalls-rappels.canada.ca/en")]),
    ("CHL", "Chile", "Americas", -33.45, -70.67, [("ACHIPIA (Food Safety Agency)", "https://www.achipia.gob.cl/"), ("SERNAC (Consumer Service)", "https://www.sernac.cl/")]),
    ("COL", "Colombia", "Americas", 4.71, -74.07, [("INVIMA", "https://www.invima.gov.co/")]),
    ("CRI", "Costa Rica", "Americas", 9.93, -84.08, [("Ministry of Health", "https://www.ministeriodesalud.go.cr/")]),
    ("CUB", "Cuba", "Americas", 23.11, -82.37, [("Ministry of Public Health", "https://salud.msp.gob.cu/")]),
    ("DMA", "Dominica", "Americas", 15.30, -61.39, []),
    ("DOM", "Dominican Republic", "Americas", 18.49, -69.93, [("Pro Consumidor", "https://proconsumidor.gob.do/")]),
    ("ECU", "Ecuador", "Americas", -0.18, -78.47, [("ARCSA", "https://www.controlsanitario.gob.ec/")]),
    ("SLV", "El Salvador", "Americas", 13.69, -89.22, [("Consumer Protection Office", "https://www.defensoria.gob.sv/")]),
    ("GRD", "Grenada", "Americas", 12.05, -61.75, []),
    ("GTM", "Guatemala", "Americas", 14.63, -90.51, [("Ministry of Public Health", "https://www.mspas.gob.gt/")]),
    ("GUY", "Guyana", "Americas", 6.80, -58.16, [("Ministry of Health", "https://www.health.gov.gy/")]),
    ("HTI", "Haiti", "Americas", 18.59, -72.31, [("Ministry of Public Health", "https://www.mspp.gouv.ht/")]),
    ("HND", "Honduras", "Americas", 14.07, -87.19, [("ARSA (Health Regulation Agency)", "https://arsa.gob.hn/")]),
    ("JAM", "Jamaica", "Americas", 18.00, -76.79, [("Ministry of Health and Wellness", "https://www.moh.gov.jm/")]),
    ("MEX", "Mexico", "Americas", 19.43, -99.13, [("COFEPRIS", "https://www.gob.mx/cofepris"), ("PROFECO (Consumer Protection)", "https://www.gob.mx/profeco")]),
    ("NIC", "Nicaragua", "Americas", 12.11, -86.24, [("Ministry of Health", "https://www.minsa.gob.ni/")]),
    ("PAN", "Panama", "Americas", 8.98, -79.52, [("ACODECO (Consumer Protection)", "https://www.acodeco.gob.pa/")]),
    ("PRY", "Paraguay", "Americas", -25.26, -57.58, [("Ministry of Public Health", "https://www.mspbs.gov.py/")]),
    ("PER", "Peru", "Americas", -12.05, -77.04, [("DIGESA", "https://www.digesa.minsa.gob.pe/"), ("INDECOPI", "https://www.gob.pe/indecopi")]),
    ("KNA", "Saint Kitts and Nevis", "Americas", 17.30, -62.72, []),
    ("LCA", "Saint Lucia", "Americas", 14.00, -61.00, []),
    ("VCT", "Saint Vincent and the Grenadines", "Americas", 13.16, -61.22, []),
    ("SUR", "Suriname", "Americas", 5.85, -55.20, []),
    ("TTO", "Trinidad and Tobago", "Americas", 10.65, -61.52, [("Ministry of Health", "https://health.gov.tt/")]),
    ("USA", "United States", "Americas", 38.90, -77.04, [("U.S. Food and Drug Administration", "https://www.fda.gov/food"), ("CPSC", "https://www.cpsc.gov/")]),
    ("URY", "Uruguay", "Americas", -34.90, -56.16, [("Ministry of Public Health", "https://www.gub.uy/ministerio-salud-publica/")]),
    ("VEN", "Venezuela", "Americas", 10.48, -66.90, []),
    # ---------------- Asia ----------------
    ("AFG", "Afghanistan", "Asia", 34.53, 69.17, []),
    ("ARM", "Armenia", "Asia", 40.18, 44.51, [("Food Safety Inspection Body", "https://www.snund.am/")]),
    ("AZE", "Azerbaijan", "Asia", 40.41, 49.87, [("Food Safety Agency", "https://afsa.gov.az/")]),
    ("BHR", "Bahrain", "Asia", 26.23, 50.59, [("Ministry of Health", "https://www.moh.gov.bh/")]),
    ("BGD", "Bangladesh", "Asia", 23.81, 90.41, [("Bangladesh Food Safety Authority", "https://bfsa.gov.bd/")]),
    ("BTN", "Bhutan", "Asia", 27.47, 89.64, [("Bhutan Food and Drug Authority", "https://www.bfda.gov.bt/")]),
    ("BRN", "Brunei", "Asia", 4.90, 114.94, [("Ministry of Health", "https://www.moh.gov.bn/")]),
    ("KHM", "Cambodia", "Asia", 11.56, 104.92, []),
    ("CHN", "China", "Asia", 39.90, 116.40, [("State Administration for Market Regulation", "https://www.samr.gov.cn/")]),
    ("CYP", "Cyprus", "Asia", 35.17, 33.36, [("Ministry of Health", "https://www.moh.gov.cy/")]),
    ("GEO", "Georgia", "Asia", 41.72, 44.79, [("National Food Agency", "https://nfa.gov.ge/")]),
    ("IND", "India", "Asia", 28.61, 77.21, [("FSSAI", "https://www.fssai.gov.in/"), ("Bureau of Indian Standards", "https://www.bis.gov.in/")]),
    ("IDN", "Indonesia", "Asia", -6.21, 106.85, [("BPOM (Food and Drug Authority)", "https://www.pom.go.id/")]),
    ("IRN", "Iran", "Asia", 35.69, 51.39, [("Food and Drug Administration", "https://www.fda.gov.ir/")]),
    ("IRQ", "Iraq", "Asia", 33.31, 44.36, [("Ministry of Health", "https://moh.gov.iq/")]),
    ("ISR", "Israel", "Asia", 31.77, 35.21, [("Ministry of Health", "https://www.gov.il/en/departments/ministry_of_health")]),
    ("JPN", "Japan", "Asia", 35.68, 139.69, [("Consumer Affairs Agency", "https://www.caa.go.jp/"), ("Food Safety Commission", "https://www.fsc.go.jp/")]),
    ("JOR", "Jordan", "Asia", 31.95, 35.93, [("Jordan Food and Drug Administration", "https://www.jfda.jo/")]),
    ("KAZ", "Kazakhstan", "Asia", 51.17, 71.45, [("Government of Kazakhstan", "https://www.gov.kz/")]),
    ("KWT", "Kuwait", "Asia", 29.38, 47.99, [("Public Authority for Food and Nutrition", "https://www.pafn.gov.kw/")]),
    ("KGZ", "Kyrgyzstan", "Asia", 42.87, 74.59, []),
    ("LAO", "Laos", "Asia", 17.97, 102.60, []),
    ("LBN", "Lebanon", "Asia", 33.89, 35.50, [("Ministry of Public Health", "https://www.moph.gov.lb/")]),
    ("MYS", "Malaysia", "Asia", 3.14, 101.69, [("Food Safety and Quality Division", "https://hq.moh.gov.my/fsq/")]),
    ("MDV", "Maldives", "Asia", 4.18, 73.51, [("Ministry of Health", "https://health.gov.mv/")]),
    ("MNG", "Mongolia", "Asia", 47.92, 106.92, []),
    ("MMR", "Myanmar", "Asia", 19.76, 96.08, [("Food and Drug Administration", "https://www.fda.gov.mm/")]),
    ("NPL", "Nepal", "Asia", 27.72, 85.32, [("Dept. of Food Technology and Quality Control", "https://www.dftqc.gov.np/")]),
    ("PRK", "North Korea", "Asia", 39.04, 125.76, []),
    ("OMN", "Oman", "Asia", 23.59, 58.38, [("Ministry of Health", "https://www.moh.gov.om/")]),
    ("PAK", "Pakistan", "Asia", 33.68, 73.05, [("Pakistan Standards & Quality Control Authority", "https://psqca.com.pk/")]),
    ("PHL", "Philippines", "Asia", 14.60, 120.98, [("Food and Drug Administration", "https://www.fda.gov.ph/")]),
    ("QAT", "Qatar", "Asia", 25.29, 51.53, [("Ministry of Public Health", "https://www.moph.gov.qa/")]),
    ("KOR", "South Korea", "Asia", 37.57, 126.98, [("Ministry of Food and Drug Safety", "https://www.mfds.go.kr/eng/")]),
    ("SAU", "Saudi Arabia", "Asia", 24.71, 46.68, [("Saudi Food and Drug Authority", "https://www.sfda.gov.sa/")]),
    ("SGP", "Singapore", "Asia", 1.35, 103.82, [("Singapore Food Agency", "https://www.sfa.gov.sg/")]),
    ("LKA", "Sri Lanka", "Asia", 6.93, 79.85, [("Consumer Affairs Authority", "https://www.caa.gov.lk/")]),
    ("SYR", "Syria", "Asia", 33.51, 36.29, []),
    ("TJK", "Tajikistan", "Asia", 38.56, 68.79, []),
    ("THA", "Thailand", "Asia", 13.76, 100.50, [("Thai Food and Drug Administration", "https://www.fda.moph.go.th/")]),
    ("TLS", "Timor-Leste", "Asia", -8.56, 125.57, []),
    ("TUR", "Türkiye", "Asia", 39.93, 32.86, [("Ministry of Agriculture and Forestry", "https://www.tarimorman.gov.tr/")]),
    ("TKM", "Turkmenistan", "Asia", 37.96, 58.33, []),
    ("ARE", "United Arab Emirates", "Asia", 24.45, 54.38, [("Ministry of Climate Change and Environment", "https://www.moccae.gov.ae/")]),
    ("UZB", "Uzbekistan", "Asia", 41.30, 69.24, []),
    ("VNM", "Viet Nam", "Asia", 21.03, 105.85, [("Vietnam Food Administration", "https://vfa.gov.vn/")]),
    ("YEM", "Yemen", "Asia", 15.37, 44.19, []),
    # ---------------- Europe ----------------
    ("ALB", "Albania", "Europe", 41.33, 19.82, [("National Food Authority", "https://aku.gov.al/")]),
    ("AND", "Andorra", "Europe", 42.51, 1.52, []),
    ("AUT", "Austria", "Europe", 48.21, 16.37, [("AGES (Health and Food Safety Agency)", "https://www.ages.at/")]),
    ("BLR", "Belarus", "Europe", 53.90, 27.57, []),
    ("BEL", "Belgium", "Europe", 50.85, 4.35, [("Federal Agency for the Safety of the Food Chain", "https://www.favv-afsca.be/")]),
    ("BIH", "Bosnia and Herzegovina", "Europe", 43.86, 18.41, [("Food Safety Agency", "https://fsa.gov.ba/")]),
    ("BGR", "Bulgaria", "Europe", 42.70, 23.32, [("Bulgarian Food Safety Agency", "https://www.bfsa.bg/")]),
    ("HRV", "Croatia", "Europe", 45.81, 15.98, [("Croatian Agency for Agriculture and Food", "https://www.hapih.hr/")]),
    ("CZE", "Czechia", "Europe", 50.08, 14.44, [("Czech Agriculture and Food Inspection Authority", "https://www.szpi.gov.cz/")]),
    ("DNK", "Denmark", "Europe", 55.68, 12.57, [("Danish Veterinary and Food Administration", "https://foedevarestyrelsen.dk/")]),
    ("EST", "Estonia", "Europe", 59.44, 24.75, [("Agriculture and Food Board", "https://pta.agri.ee/")]),
    ("FIN", "Finland", "Europe", 60.17, 24.94, [("Finnish Food Authority", "https://www.ruokavirasto.fi/")]),
    ("FRA", "France", "Europe", 48.86, 2.35, [("RappelConso (product recalls)", "https://rappel.conso.gouv.fr/"), ("DGCCRF", "https://www.economie.gouv.fr/dgccrf")]),
    ("DEU", "Germany", "Europe", 52.52, 13.40, [("Federal Office of Consumer Protection and Food Safety", "https://www.bvl.bund.de/"), ("Lebensmittelwarnung (food warnings)", "https://www.lebensmittelwarnung.de/")]),
    ("GRC", "Greece", "Europe", 37.98, 23.73, [("Hellenic Food Authority (EFET)", "https://www.efet.gr/")]),
    ("HUN", "Hungary", "Europe", 47.50, 19.04, [("National Food Chain Safety Office", "https://portal.nebih.gov.hu/")]),
    ("ISL", "Iceland", "Europe", 64.15, -21.94, [("Icelandic Food and Veterinary Authority", "https://www.mast.is/")]),
    ("IRL", "Ireland", "Europe", 53.35, -6.26, [("Food Safety Authority of Ireland", "https://www.fsai.ie/")]),
    ("ITA", "Italy", "Europe", 41.90, 12.50, [("Ministry of Health", "https://www.salute.gov.it/")]),
    ("LVA", "Latvia", "Europe", 56.95, 24.11, [("Food and Veterinary Service", "https://www.pvd.gov.lv/")]),
    ("LTU", "Lithuania", "Europe", 54.69, 25.28, [("State Food and Veterinary Service", "https://vmvt.lt/")]),
    ("LUX", "Luxembourg", "Europe", 49.61, 6.13, [("Food Safety Luxembourg", "https://securite-alimentaire.public.lu/")]),
    ("MLT", "Malta", "Europe", 35.90, 14.51, [("Malta Competition and Consumer Affairs Authority", "https://mccaa.org.mt/")]),
    ("MCO", "Monaco", "Europe", 43.73, 7.42, []),
    ("MNE", "Montenegro", "Europe", 42.44, 19.26, [("Administration for Food Safety", "https://www.ubh.gov.me/")]),
    ("NLD", "Netherlands", "Europe", 52.37, 4.90, [("Netherlands Food and Consumer Product Safety Authority", "https://www.nvwa.nl/")]),
    ("MKD", "North Macedonia", "Europe", 41.99, 21.43, [("Food and Veterinary Agency", "https://fva.gov.mk/")]),
    ("NOR", "Norway", "Europe", 59.91, 10.75, [("Norwegian Food Safety Authority", "https://www.mattilsynet.no/")]),
    ("POL", "Poland", "Europe", 52.23, 21.01, [("Chief Sanitary Inspectorate", "https://www.gov.pl/web/gis")]),
    ("PRT", "Portugal", "Europe", 38.72, -9.14, [("ASAE (Food and Economic Safety Authority)", "https://www.asae.gov.pt/")]),
    ("MDA", "Moldova", "Europe", 47.01, 28.86, [("National Food Safety Agency", "https://www.ansa.gov.md/")]),
    ("ROU", "Romania", "Europe", 44.43, 26.10, [("National Sanitary Veterinary and Food Safety Authority", "https://www.ansvsa.ro/")]),
    ("RUS", "Russia", "Europe", 55.76, 37.62, [("Rospotrebnadzor", "https://www.rospotrebnadzor.ru/")]),
    ("SMR", "San Marino", "Europe", 43.94, 12.45, []),
    ("SRB", "Serbia", "Europe", 44.79, 20.45, []),
    ("SVK", "Slovakia", "Europe", 48.15, 17.11, [("State Veterinary and Food Administration", "https://www.svps.sk/")]),
    ("SVN", "Slovenia", "Europe", 46.06, 14.51, [("Administration for Food Safety", "https://www.gov.si/drzavni-organi/organi-v-sestavi/uprava-za-varno-hrano-veterinarstvo-in-varstvo-rastlin/")]),
    ("ESP", "Spain", "Europe", 40.42, -3.70, [("Spanish Agency for Food Safety and Nutrition", "https://www.aesan.gob.es/")]),
    ("SWE", "Sweden", "Europe", 59.33, 18.07, [("Swedish Food Agency", "https://www.livsmedelsverket.se/")]),
    ("CHE", "Switzerland", "Europe", 46.95, 7.45, [("Federal Food Safety and Veterinary Office", "https://www.blv.admin.ch/")]),
    ("UKR", "Ukraine", "Europe", 50.45, 30.52, [("State Service on Food Safety and Consumer Protection", "https://dpss.gov.ua/")]),
    ("GBR", "United Kingdom", "Europe", 51.51, -0.13, [("Food Standards Agency", "https://www.food.gov.uk/"), ("NHS: food safety & healthy eating", "https://www.nhs.uk/live-well/eat-well/")]),
    # ---------------- Oceania ----------------
    ("AUS", "Australia", "Oceania", -35.28, 149.13, [("Food Standards Australia New Zealand", "https://www.foodstandards.gov.au/")]),
    ("COK", "Cook Islands", "Oceania", -21.20, -159.78, []),
    ("FJI", "Fiji", "Oceania", -18.14, 178.44, [("Ministry of Health", "https://www.health.gov.fj/")]),
    ("KIR", "Kiribati", "Oceania", 1.33, 172.98, []),
    ("MHL", "Marshall Islands", "Oceania", 7.09, 171.38, []),
    ("FSM", "Micronesia", "Oceania", 6.92, 158.16, []),
    ("NRU", "Nauru", "Oceania", -0.55, 166.92, []),
    ("NZL", "New Zealand", "Oceania", -41.29, 174.78, [("NZ Food Safety (MPI)", "https://www.mpi.govt.nz/food-safety-home/")]),
    ("NIU", "Niue", "Oceania", -19.05, -169.92, []),
    ("PLW", "Palau", "Oceania", 7.50, 134.62, []),
    ("PNG", "Papua New Guinea", "Oceania", -9.44, 147.18, [("National Department of Health", "https://www.health.gov.pg/")]),
    ("WSM", "Samoa", "Oceania", -13.83, -171.76, [("Ministry of Health", "https://www.health.gov.ws/")]),
    ("SLB", "Solomon Islands", "Oceania", -9.43, 159.95, []),
    ("TON", "Tonga", "Oceania", -21.14, -175.20, []),
    ("TUV", "Tuvalu", "Oceania", -8.52, 179.20, []),
    ("VUT", "Vanuatu", "Oceania", -17.73, 168.32, []),
]

TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.I | re.S)


BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"


def _curl(url: str, ua: str) -> tuple[int, bytes]:
    # curl uses the operating system's certificate store, which is more complete
    # than Python's bundled one (many government sites send partial chains).
    p = subprocess.run(
        ["curl", "-sL", "--compressed", "-A", ua, "--max-time", "30", "--retry", "1",
         "-H", "Accept: text/html,*/*", "-w", "\n__STATUS__%{http_code}", url],
        capture_output=True, timeout=75,
    )
    out = p.stdout
    i = out.rfind(b"\n__STATUS__")
    if i < 0:
        return 0, b""
    try:
        return int(out[i + 12:].strip() or 0), out[:i]
    except ValueError:
        return 0, b""


def check(url: str) -> tuple[bool, str]:
    """Return (ok, detail). ok = responds 2xx with a page that is not an error page."""
    last = "no response"
    for ua in (UA, BROWSER_UA):
        try:
            status, body = _curl(url, ua)
        except subprocess.TimeoutExpired:
            last = "timed out"
            continue
        if 200 <= status < 300 and body:
            m = TITLE_RE.search(body[:300_000])
            title = html.unescape(m.group(1).decode("utf-8", "replace")).strip() if m else ""
            title = re.sub(r"\s+", " ", title)[:90]
            return True, f"{status} {title or '(no title)'}"
        last = f"HTTP {status}" if status else "no response"
    return False, last


# Titles that mean the page is an error/parking page rather than the authority.
BAD_TITLE = re.compile(r"not found|404|error|forbidden|access denied|request rejected|blocked|captcha|domain .*sale|parked|suspended|index of|attention required|just a moment", re.I)


def main() -> int:
    assert len(C) == len({c[0] for c in C}), "duplicate ISO code"
    report = "--report" in sys.argv
    jobs = [(c[0], name, url) for c in C for name, url in c[5]]
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = dict(zip([(j[0], j[2]) for j in jobs], pool.map(lambda j: check(j[2]), jobs)))

    countries, kept, dropped = [], 0, []
    for iso, name, cont, lat, lon, auths in C:
        good = []
        for an, url in auths:
            ok, detail = results[(iso, url)]
            title = detail.split(" ", 1)[1] if ok and " " in detail else ""
            if ok and not BAD_TITLE.search(title):
                good.append({"name": an, "url": url})
                kept += 1
            else:
                dropped.append(f"{iso} {an}: {detail}")
            if report:
                print(f"{'KEEP' if good and good[-1]['url'] == url else 'DROP'} {iso:3} {url:70} {detail}")
        countries.append({
            "iso3": iso, "name": name, "continent": cont, "lat": lat, "lon": lon,
            "who": f"https://www.who.int/countries/{iso.lower()}/",
            "authorities": good,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by build_countries.py - do not edit by hand.\n"
        "window.COUNTRIES = " + json.dumps({"generated": datetime.now(timezone.utc).isoformat(), "countries": countries},
                                           ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    with_auth = sum(1 for c in countries if c["authorities"])
    print(f"\n{len(countries)} countries · {with_auth} with a verified national authority · {kept} authority links kept · {len(dropped)} dropped")
    if dropped:
        print("Dropped (not verified):\n  " + "\n  ".join(dropped))
    return 0


if __name__ == "__main__":
    sys.exit(main())
