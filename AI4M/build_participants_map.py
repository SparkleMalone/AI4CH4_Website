#!/usr/bin/env python3
"""
Read affiliation from 'WG Member Contact 2025 web.xlsx', geocode, and write
participants_map_data.json for the world map.
"""
import json
import time
from collections import defaultdict

import openpyxl
from geopy import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

EXCEL_PATH = "WG Member Contact 2025 web.xlsx"
AFFILIATION_COL = 5  # 1-based column E
OUTPUT_JSON = "participants_map_data.json"
NOMINATIM_DELAY = 1.1  # seconds between requests (rate limit)

# Fallback (lat, lon, place) for affiliations Nominatim cannot resolve
FALLBACKS = {
    "NOAA Global Monitoring Laboratory": (40.015, -105.27, "Boulder, CO, USA"),
    "NOAA Global Monitoring Laboratory & CU Boulder": (40.015, -105.27, "Boulder, CO, USA"),
    "Joint Global Change Research Institute, Pacific Northwest National Lab": (46.34, -119.29, "Richland, WA, USA"),
    "Pacific Northwets National Laboratory": (46.34, -119.29, "Richland, WA, USA"),
    "UMD ESSIC & NASA GSFC": (38.99, -76.94, "College Park, MD, USA"),
    "Earth System Science Interdisciplinary Center, University of Maryland College Park": (38.99, -76.94, "College Park, MD, USA"),
    "Spark Climate Solutions": (37.77, -122.42, "San Francisco, CA, USA"),
    "AtmoFacts": (40.71, -74.01, "New York, NY, USA"),
    "Institute of Tibetan Plateau Research, Chinese Academy of Sciences": (29.65, 91.1, "Lhasa, China"),
    "Institute of Tibetan Plateau Research, Chinese Academy of Sciences, Beijing": (39.9, 116.4, "Beijing, China"),
}


def main():
    # 1) Read affiliations from Excel
    wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
    ws = wb.active
    affiliations = []
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, values_only=True):
        if row and len(row) >= AFFILIATION_COL:
            aff = row[AFFILIATION_COL - 1]
            if aff and isinstance(aff, str):
                aff = aff.strip()
                if aff:
                    affiliations.append(aff)
    wb.close()

    # Count by affiliation
    aff_count = defaultdict(int)
    for a in affiliations:
        aff_count[a] += 1

    # 2) Geocode each unique affiliation
    geocoder = Nominatim(user_agent="AI4Methane-participants-map")
    loc_to_data = {}  # (round_lat, round_lon) -> { lat, lon, place, institutions: [{name, count}], count }

    for aff, count in sorted(aff_count.items()):
        lat, lon, place = None, None, None
        if aff in FALLBACKS:
            lat, lon, place = FALLBACKS[aff]
        else:
            time.sleep(NOMINATIM_DELAY)
            try:
                loc = geocoder.geocode(aff, timeout=10)
            except (GeocoderTimedOut, GeocoderServiceError):
                print("Skip (geocode error):", aff)
                continue
            if not loc:
                print("Skip (no result):", aff)
                continue
            lat, lon = loc.latitude, loc.longitude
            place = loc.raw.get("display_name", loc.address) if hasattr(loc, "raw") else loc.address
        if lat is None:
            continue
        # Round to ~11km grid to merge nearby pins
        key = (round(lat, 2), round(lon, 2))
        if key not in loc_to_data:
            loc_to_data[key] = {
                "lat": lat,
                "lon": lon,
                "place": place,
                "institutions": [],
                "count": 0,
            }
        loc_to_data[key]["institutions"].append({"name": aff, "count": count})
        loc_to_data[key]["count"] += count
        # Keep first geocoded place name (or we could prefer longer count)
        if len(loc_to_data[key]["institutions"]) == 1:
            loc_to_data[key]["place"] = place

    # 3) Build output list (one entry per location)
    out = []
    for key in sorted(loc_to_data.keys(), key=lambda k: (-loc_to_data[k]["count"], k)):
        d = loc_to_data[key]
        out.append({
            "lat": d["lat"],
            "lon": d["lon"],
            "place": d["place"],
            "institutions": d["institutions"],
            "count": d["count"],
        })

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print("Wrote", OUTPUT_JSON, "with", len(out), "locations and", sum(d["count"] for d in out), "participants.")


if __name__ == "__main__":
    main()
