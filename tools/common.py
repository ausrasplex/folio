#!/usr/bin/env python3
"""One-off shared edits applied to every generated screen (header, avatar, household switch, sign-out)."""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'src', 'screens')
for f in sorted(os.listdir(D)):
    p = os.path.join(D, f); s = open(p).read(); n0 = s
    s = s.replace("import { DCBase, css, R } from '../lib/dc';", "import { DCBase, css, R, HouseholdSwitch } from '../lib/dc';")
    # profile avatar: real initials / photo
    s = re.sub(r'<a href=\{"/profile"\} style=\{css\("([^"]*)"\)\} aria-label="Your profile">AL</a>',
               lambda m: '<a href={"/profile"} style={css("%s" + (v.mePhotoSt || ""))} aria-label="Your profile">{v.meIni}</a>' % m.group(1), s)
    # household switcher
    s = re.sub(r'<button className="hbs" type="button" style=\{css\("([^"]*)"\)\}>\{v\.hhLabel\} (<svg.*?</svg>)</button>',
               lambda m: '<HouseholdSwitch style={css("%s")} chevron={%s} />' % (m.group(1), m.group(2).replace('aria-hidden="true"', 'aria-hidden="true"')), s, count=1, flags=re.S)
    # sign out
    s = re.sub(r'<a className="navlink" href=\{"#"\}', '<a className="navlink" href={"/signout"}', s)
    s = s.replace('href={"#"} aria-label="Log out"', 'href={"/signout"} aria-label="Log out"')
    # save theme on the server too
    s = s.replace("saveTheme(themeId, mode) {", "saveTheme(themeId, mode) {\n    this.saveThemeServer(themeId, mode);", 1)
    if s != n0:
        open(p, 'w').write(s)
    print(f, 'avatar' if '{v.meIni}' in s else '-', 'hh' if 'HouseholdSwitch style' in s else '-', 'out' if '/signout' in s else '-')
