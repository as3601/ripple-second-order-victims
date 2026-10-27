"""Pull real-world data from OpenStreetMap into osm_cache.json.

  * Junction / facility coordinates: OSM Nominatim geocoder
  * Road-segment distance & drive time: OSRM routing over the OSM road network

Run once with internet (`python fetch_osm.py`, ~1 min). The app then reads the cache, so the
demo works offline. A geocode that lands >3 km from the curated position is rejected as a bad
match and the curated value is kept.
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import city
from engine import haversine_km

OUT = Path(__file__).parent / "osm_cache.json"
UA = {"User-Agent": "Ripple-CodeYudh-hackathon/0.1"}
VIEWBOX = "76.55,30.80,76.90,30.62"  # tricity bounding box (lon1,lat1,lon2,lat2)
MAX_SHIFT_KM = 3.0

QUERIES = {
    "pgi": "PGIMER, Chandigarh",
    "sec16": "Government Multi Specialty Hospital, Sector 16, Chandigarh",
    "sec17": "Sector 17 Plaza, Chandigarh",
    "sec10": "Sector 10, Chandigarh",
    "sec7": "Sector 7, Chandigarh",
    "transport": "Transport Chowk, Chandigarh",
    "hb": "Housing Board Chowk, Chandigarh",
    "manimajra": "Mani Majra, Chandigarh",
    "itpark": "Chandigarh IT Park",
    "panchkula": "Civil Hospital, Sector 6, Panchkula",
    "sec22": "Sector 22, Chandigarh",
    "sec35": "Sector 35, Chandigarh",
    "isbt43": "ISBT Sector 43, Chandigarh",
    "sec32": "Government Medical College and Hospital, Sector 32, Chandigarh",
    "tribune": "Tribune Chowk, Chandigarh",
    "industrial": "Industrial Area Phase 1, Chandigarh",
    "ramdarbar": "Ram Darbar, Chandigarh",
    "sec47": "Sector 47, Chandigarh",
    "fortis": "Fortis Hospital, Mohali",
    "mohali_ind": "Industrial Area Phase 8B, Mohali",
    "zirakpur": "Zirakpur",
    "kharar": "Kharar",
    "landran": "Landran",
    "dhanas": "Dhanas, Chandigarh",
    "cu": "Chandigarh University, Gharuan",
}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return json.loads(r.read())


def geocode():
    coords = {}
    for jid, q in QUERIES.items():
        name, lat0, lon0 = city.CURATED_JUNCTIONS[jid]
        url = ("https://nominatim.openstreetmap.org/search?format=json&limit=1&bounded=1&viewbox="
               + VIEWBOX + "&q=" + urllib.parse.quote(q))
        try:
            hits = get(url)
        except Exception as e:
            print(f"  ! {jid}: {e}")
            hits = []
        if hits:
            lat, lon = float(hits[0]["lat"]), float(hits[0]["lon"])
            shift = haversine_km(lat0, lon0, lat, lon)
            if shift <= MAX_SHIFT_KM:
                coords[jid] = {"lat": round(lat, 6), "lon": round(lon, 6), "osm": hits[0]["display_name"][:90]}
                print(f"  ok {jid:11s} moved {shift:.2f} km  <- {hits[0]['display_name'][:60]}")
            else:
                print(f"  -- {jid:11s} rejected ({shift:.1f} km away: {hits[0]['display_name'][:50]})")
        else:
            print(f"  -- {jid:11s} no OSM match, keeping curated position")
        time.sleep(1.1)  # Nominatim usage policy: max 1 request/second
    return coords


def route_edges(coords):
    edges = {}
    pos = lambda j: (coords[j]["lat"], coords[j]["lon"]) if j in coords else city.CURATED_JUNCTIONS[j][1:]
    for a, b, kind, name in city.ROADS:
        (la, oa), (lb, ob) = pos(a), pos(b)
        url = f"https://router.project-osrm.org/route/v1/driving/{oa},{la};{ob},{lb}?overview=false"
        try:
            r = get(url)
            leg = r["routes"][0]
            edges["|".join(sorted((a, b)))] = {"km": round(leg["distance"] / 1000, 2),
                                                "min": round(leg["duration"] / 60, 2)}
            print(f"  ok {name:35s} {leg['distance'] / 1000:5.1f} km {leg['duration'] / 60:5.1f} min")
        except Exception as e:
            print(f"  ! {name}: {e}")
        time.sleep(0.3)
    return edges


if __name__ == "__main__":
    print("Geocoding junctions via OSM Nominatim...")
    coords = geocode()
    print("Routing road segments via OSRM...")
    edges = route_edges(coords)
    OUT.write_text(json.dumps({"fetched": time.strftime("%Y-%m-%d %H:%M"),
                               "source": "OpenStreetMap (Nominatim + OSRM), ODbL",
                               "junctions": coords, "edges": edges}, indent=1), encoding="utf-8")
    print(f"Saved {len(coords)}/{len(city.JUNCTIONS)} junctions and {len(edges)}/{len(city.ROADS)} edges to {OUT.name}")
