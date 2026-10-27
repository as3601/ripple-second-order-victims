"""Dependency graph for the Chandigarh tricity (Chandigarh, Mohali, Panchkula).

Hand-curated prototype data. Junction coordinates are approximate and
populations / capacities are illustrative, scaled from public census-ward
figures. In production this layer is rebuilt from OpenStreetMap (OSMnx),
GTFS feeds and data.gov.in facility registries.
"""

# id: (name, lat, lon)
JUNCTIONS = {
    "pgi":        ("PGI Chowk", 30.7646, 76.7770),
    "sec16":      ("Sector 16/17 Chowk", 30.7470, 76.7860),
    "sec17":      ("Sector 17 Plaza", 30.7398, 76.7827),
    "sec10":      ("Sector 9/10 (Madhya Marg)", 30.7530, 76.7960),
    "sec7":       ("Sector 7/26 Chowk", 30.7420, 76.8060),
    "transport":  ("Transport Chowk", 30.7250, 76.8170),
    "hb":         ("Housing Board Chowk", 30.7130, 76.8330),
    "manimajra":  ("Manimajra", 30.7230, 76.8400),
    "itpark":     ("IT Park", 30.7290, 76.8480),
    "panchkula":  ("Panchkula Sec 5/6", 30.6960, 76.8560),
    "sec22":      ("Sector 22/23", 30.7330, 76.7720),
    "sec35":      ("Sector 35/36", 30.7230, 76.7610),
    "isbt43":     ("ISBT Sector 43", 30.7190, 76.7500),
    "sec32":      ("Sector 32 (GMCH)", 30.7060, 76.7790),
    "tribune":    ("Tribune Chowk", 30.7180, 76.7950),
    "industrial": ("Industrial Area Ph-1", 30.7040, 76.8020),
    "ramdarbar":  ("Ram Darbar", 30.6940, 76.7960),
    "sec47":      ("Sector 47/48", 30.6990, 76.7660),
    "mohali7":    ("Mohali Phase 7", 30.7080, 76.7230),
    "fortis":     ("Mohali Phase 8 (Fortis)", 30.6942, 76.7329),
    "mohali_ind": ("Mohali Industrial Ph-8B", 30.6870, 76.7140),
    "airport":    ("Airport Road Chowk", 30.6720, 76.7650),
    "zirakpur":   ("Zirakpur", 30.6450, 76.8180),
    "kharar":     ("Kharar", 30.7460, 76.6450),
    "landran":    ("Landran", 30.6950, 76.6650),
    "dhanas":     ("Dhanas", 30.7690, 76.7550),
    "cu":         ("Chandigarh University (Gharuan)", 30.7700, 76.5750),
}

# (a, b, kind, name) -- kind: road | bridge | flyover. Speed inferred from kind.
ROADS = [
    ("pgi", "sec16", "road", "Madhya Marg (PGI-16)"),
    ("pgi", "dhanas", "road", "Dhanas Road"),
    ("sec16", "sec17", "road", "Jan Marg"),
    ("sec16", "sec10", "road", "Madhya Marg (16-10)"),
    ("sec10", "sec7", "road", "Madhya Marg (10-7)"),
    ("sec7", "transport", "road", "Madhya Marg (7-26)"),
    ("transport", "hb", "road", "Madhya Marg (26-HB)"),
    ("hb", "manimajra", "road", "Manimajra Road"),
    ("manimajra", "itpark", "road", "IT Park Road"),
    ("hb", "panchkula", "bridge", "Sukhna Choe Bridge"),
    ("sec17", "sec22", "road", "Udyog Path"),
    ("sec17", "tribune", "road", "Dakshin Marg (17-Tribune)"),
    ("sec22", "sec35", "road", "Himalaya Marg"),
    ("sec35", "isbt43", "road", "Dakshin Marg (35-43)"),
    ("sec35", "sec32", "road", "Purv Marg"),
    ("sec32", "tribune", "road", "Dakshin Marg (32-Tribune)"),
    ("tribune", "transport", "flyover", "Tribune Chowk Flyover"),
    ("tribune", "industrial", "road", "Purv Marg (Industrial)"),
    ("industrial", "ramdarbar", "road", "Ram Darbar Road"),
    ("industrial", "hb", "road", "Industrial Area Link"),
    ("ramdarbar", "zirakpur", "flyover", "Zirakpur Flyover"),
    ("airport", "zirakpur", "road", "Airport Road (Zirakpur)"),
    ("panchkula", "zirakpur", "road", "Panchkula-Zirakpur Highway"),
    ("isbt43", "mohali7", "road", "Kharar Road (43-Ph7)"),
    ("isbt43", "sec47", "road", "Sector 43-47 Road"),
    ("sec47", "sec32", "road", "Sector 47-32 Road"),
    ("sec47", "airport", "road", "Airport Road (47)"),
    ("mohali7", "fortis", "road", "Phase 7-8 Road"),
    ("fortis", "mohali_ind", "road", "Industrial Area Road (Mohali)"),
    ("fortis", "airport", "road", "Airport Road (Mohali)"),
    ("mohali7", "kharar", "bridge", "Patiala-ki-Rao Choe Bridge"),
    ("mohali_ind", "landran", "road", "Landran Road"),
    ("landran", "kharar", "road", "Landran-Kharar Road"),
    ("kharar", "cu", "road", "NH-205A (Kharar-Gharuan)"),
    ("landran", "cu", "road", "Landran-Gharuan Road"),
    ("dhanas", "kharar", "road", "Kharar-Dhanas Link"),
]

# Hospitals: capacity = emergency beds; load = baseline daily emergency arrivals
HOSPITALS = {
    "h_pgi":   {"name": "PGIMER", "at": "pgi", "er_beds": 160, "baseline_load": 0.85},
    "h_gmch":  {"name": "GMCH-32", "at": "sec32", "er_beds": 90, "baseline_load": 0.80},
    "h_gmsh":  {"name": "GMSH-16", "at": "sec16", "er_beds": 70, "baseline_load": 0.82},
    "h_fortis": {"name": "Fortis Mohali", "at": "fortis", "er_beds": 45, "baseline_load": 0.70},
    "h_pkl":   {"name": "Civil Hospital Panchkula", "at": "panchkula", "er_beds": 50, "baseline_load": 0.78},
    "h_khr":   {"name": "Civil Hospital Kharar", "at": "kharar", "er_beds": 25, "baseline_load": 0.75},
}

AMBULANCE_BASES = {
    "a_17":  {"name": "108 Base Sector 17", "at": "sec17"},
    "a_hb":  {"name": "108 Base Manimajra", "at": "manimajra"},
    "a_moh": {"name": "108 Base Mohali", "at": "mohali7"},
    "a_zkp": {"name": "108 Base Zirakpur", "at": "zirakpur"},
}

# Medicine supply: central depots restock neighbourhood pharmacies daily.
DEPOTS = {
    "d_ind": {"name": "Central Drug Depot, Industrial Area", "at": "industrial"},
    "d_moh": {"name": "Pharma Distributors, Mohali Ph-8B", "at": "mohali_ind"},
}

WORKPLACES = {
    "w_ind":    {"name": "Industrial Area Ph-1", "at": "industrial"},
    "w_itpark": {"name": "IT Park", "at": "itpark"},
    "w_mohind": {"name": "Mohali Industrial Area", "at": "mohali_ind"},
    "w_sec17":  {"name": "Sector 17 Markets", "at": "sec17"},
}

SCHOOLS = {
    "s_gmss16":  {"name": "Govt Model Sr Sec School, Sec 16", "at": "sec16"},
    "s_gmss35":  {"name": "Govt Model Sr Sec School, Sec 35", "at": "sec35"},
    "s_dps":     {"name": "Delhi Public School, Sec 40", "at": "isbt43"},
    "s_pkl":     {"name": "Govt School, Panchkula Sec 6", "at": "panchkula"},
    "s_moh":     {"name": "Shivalik Public School, Mohali", "at": "mohali7"},
    "s_cu":      {"name": "Chandigarh University", "at": "cu"},
}

# Residential zones and who lives there. Each zone depends on: a school, a
# workplace, a medicine depot (via its pharmacies) and emergency care.
ZONES = {
    "z_manimajra": {"name": "Manimajra", "at": "manimajra", "pop": 95000, "elderly": 0.09,
                    "children": 0.24, "low_income": 0.38, "workers": 0.36, "daily_wage": 0.45,
                    "school": "s_gmss16", "work": "w_ind", "depot": "d_ind"},
    "z_panchkula": {"name": "Panchkula Sec 4-12", "at": "panchkula", "pop": 120000, "elderly": 0.13,
                    "children": 0.20, "low_income": 0.18, "workers": 0.38, "daily_wage": 0.20,
                    "school": "s_pkl", "work": "w_itpark", "depot": "d_ind"},
    "z_zirakpur":  {"name": "Zirakpur", "at": "zirakpur", "pop": 140000, "elderly": 0.08,
                    "children": 0.22, "low_income": 0.25, "workers": 0.42, "daily_wage": 0.30,
                    "school": "s_pkl", "work": "w_ind", "depot": "d_ind"},
    "z_sec22":     {"name": "Sectors 21-23", "at": "sec22", "pop": 60000, "elderly": 0.16,
                    "children": 0.18, "low_income": 0.10, "workers": 0.40, "daily_wage": 0.12,
                    "school": "s_gmss16", "work": "w_sec17", "depot": "d_ind"},
    "z_burail":    {"name": "Burail / Sec 45", "at": "sec35", "pop": 70000, "elderly": 0.07,
                    "children": 0.27, "low_income": 0.52, "workers": 0.40, "daily_wage": 0.60,
                    "school": "s_gmss35", "work": "w_ind", "depot": "d_ind"},
    "z_ramdarbar": {"name": "Ram Darbar Colony", "at": "ramdarbar", "pop": 55000, "elderly": 0.06,
                    "children": 0.28, "low_income": 0.62, "workers": 0.44, "daily_wage": 0.70,
                    "school": "s_gmss35", "work": "w_ind", "depot": "d_ind"},
    "z_mohali":    {"name": "Mohali Ph 3-7", "at": "mohali7", "pop": 110000, "elderly": 0.12,
                    "children": 0.20, "low_income": 0.15, "workers": 0.40, "daily_wage": 0.18,
                    "school": "s_dps", "work": "w_sec17", "depot": "d_moh"},
    "z_kharar":    {"name": "Kharar", "at": "kharar", "pop": 130000, "elderly": 0.09,
                    "children": 0.25, "low_income": 0.34, "workers": 0.40, "daily_wage": 0.40,
                    "school": "s_moh", "work": "w_mohind", "depot": "d_moh"},
    "z_dhanas":    {"name": "Dhanas / Sarangpur", "at": "dhanas", "pop": 45000, "elderly": 0.06,
                    "children": 0.29, "low_income": 0.66, "workers": 0.43, "daily_wage": 0.72,
                    "school": "s_gmss16", "work": "w_sec17", "depot": "d_ind"},
    "z_gharuan":   {"name": "Gharuan + CU hostels", "at": "cu", "pop": 40000, "elderly": 0.05,
                    "children": 0.10, "low_income": 0.30, "workers": 0.25, "daily_wage": 0.35,
                    "school": "s_cu", "work": "w_mohind", "depot": "d_moh"},
    "z_sec47":     {"name": "Sectors 46-49", "at": "sec47", "pop": 65000, "elderly": 0.14,
                    "children": 0.19, "low_income": 0.14, "workers": 0.39, "daily_wage": 0.14,
                    "school": "s_dps", "work": "w_sec17", "depot": "d_ind"},
}
