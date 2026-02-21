#!/usr/bin/env python3
"""
iTrader.im Brand Asset Generator
Reads create-ui-components-2.json and produces all production brand assets.
"""

import json
import math
import os
import struct
import zipfile
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    import cairosvg
    HAS_CAIRO = True
except Exception:
    HAS_CAIRO = False

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "private" / "create-ui-components-2.json"
OUTPUT_DIR = ROOT / "brand-assets"

with open(JSON_PATH, "r", encoding="utf-8") as f:
    BRAND = json.load(f)

C = BRAND["colorSystem"]
G = BRAND["gradientSystem"]["gradients"]
GLOW = BRAND["glowSystem"]
ICON = BRAND["iconSystem"]
LOGO = BRAND["logoSystem"]
TYPO = BRAND["typographySystem"]
SURFACE = BRAND["surfaceSystem"]
BADGES = BRAND["badgeSystem"]
CATEGORIES = BRAND["categoryExpressions"]
MOTION = BRAND["motionGraphics"]
APP_ICON = BRAND["appIconSystem"]


def color(name):
    """Resolve a color token name to hex."""
    mapping = {
        "graphiteBackground": C["graphiteBackground"]["hex"],
        "carbonDark": C["carbonDark"]["hex"],
        "slateSurface": C["slateSurface"]["hex"],
        "neonRed": C["neonRed"]["hex"],
        "deepRed": C["deepRed"]["hex"],
        "electricBlue": C["electricBlue"]["hex"],
        "deepBlue": C["deepBlue"]["hex"],
        "silverMetallic": C["silverMetallic"]["hex"],
        "silverHighlight": C["silverHighlight"]["hex"],
        "premiumGold": C["premiumGold"]["hex"],
        "pureWhite": C["pureWhite"]["hex"],
        "accentStreakRed": C["accentStreakRed"]["hex"],
        "accentStreakBlue": C["accentStreakBlue"]["hex"],
    }
    if name.startswith("#"):
        return name
    return mapping.get(name, "#FFFFFF")


def find_gradient(name):
    for g in G:
        if g["name"] == name:
            return g
    return None


def svg_gradient_def(grad, gid):
    """Generate SVG gradient definition from JSON gradient spec."""
    if not grad:
        return ""
    if grad["type"] == "linear":
        angle = grad.get("angle", 0)
        rad = math.radians(angle)
        x1 = 50 - 50 * math.cos(rad)
        y1 = 50 - 50 * math.sin(rad)
        x2 = 50 + 50 * math.cos(rad)
        y2 = 50 + 50 * math.sin(rad)
        stops = ""
        for s in grad["stops"]:
            opacity = s.get("opacity", 1)
            stops += f'<stop offset="{s["position"]}%" stop-color="{s["color"]}" stop-opacity="{opacity}"/>\n'
        return f'<linearGradient id="{gid}" x1="{x1:.1f}%" y1="{y1:.1f}%" x2="{x2:.1f}%" y2="{y2:.1f}%">\n{stops}</linearGradient>'
    elif grad["type"] == "radial":
        stops = ""
        for s in grad["stops"]:
            opacity = s.get("opacity", 1)
            stops += f'<stop offset="{s["position"]}%" stop-color="{s["color"]}" stop-opacity="{opacity}"/>\n'
        return f'<radialGradient id="{gid}" cx="50%" cy="50%" r="50%">\n{stops}</radialGradient>'
    return ""


def svg_glow_filter(fid, glow_color, blur_px, spread_px=0, opacity=0.5):
    return f'''<filter id="{fid}" x="-50%" y="-50%" width="200%" height="200%">
  <feDropShadow dx="0" dy="0" stdDeviation="{blur_px/2}" flood-color="{glow_color}" flood-opacity="{opacity}"/>
</filter>'''


def svg_drop_shadow_filter(fid, dx, dy, blur, col="#000000", opacity=0.5):
    return f'''<filter id="{fid}" x="-50%" y="-50%" width="200%" height="200%">
  <feDropShadow dx="{dx}" dy="{dy}" stdDeviation="{blur/2}" flood-color="{col}" flood-opacity="{opacity}"/>
</filter>'''


def svg_gaussian_blur_filter(fid, blur):
    return f'''<filter id="{fid}" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="{blur/2}"/>
</filter>'''


def ellipse_point(cx, cy, rx, ry, rot_deg, t_deg):
    """Point on rotated ellipse at parameter t (degrees)."""
    t = math.radians(t_deg)
    rot = math.radians(rot_deg)
    x = rx * math.cos(t)
    y = ry * math.sin(t)
    xr = x * math.cos(rot) - y * math.sin(rot) + cx
    yr = x * math.sin(rot) + y * math.cos(rot) + cy
    return xr, yr


def ellipse_normal(rx, ry, rot_deg, t_deg):
    """Outward normal on rotated ellipse at parameter t."""
    t = math.radians(t_deg)
    rot = math.radians(rot_deg)
    dx = -rx * math.sin(t)
    dy = ry * math.cos(t)
    tx = dx * math.cos(rot) - dy * math.sin(rot)
    ty = dx * math.sin(rot) + dy * math.cos(rot)
    length = math.sqrt(tx * tx + ty * ty)
    if length < 1e-9:
        return 0, 1
    nx = -ty / length
    ny = tx / length
    return nx, ny


def tapered_arc_path(cx, cy, rx, ry, rot_deg, start_deg, end_deg, max_thickness,
                      start_ratio=1.0, end_ratio=0.18, exponent=1.8, steps=80):
    """Create SVG path for a tapered elliptical arc."""
    outer_points = []
    inner_points = []
    for i in range(steps + 1):
        s = i / steps
        t = start_deg + s * (end_deg - start_deg)
        px, py = ellipse_point(cx, cy, rx, ry, rot_deg, t)
        nx, ny = ellipse_normal(rx, ry, rot_deg, t)
        thickness_factor = start_ratio * (1 - s ** exponent) + end_ratio * (s ** exponent)
        half_w = max_thickness * thickness_factor / 2
        outer_points.append((px + nx * half_w, py + ny * half_w))
        inner_points.append((px - nx * half_w, py - ny * half_w))
    
    path_parts = [f"M {outer_points[0][0]:.2f} {outer_points[0][1]:.2f}"]
    for p in outer_points[1:]:
        path_parts.append(f"L {p[0]:.2f} {p[1]:.2f}")
    for p in reversed(inner_points):
        path_parts.append(f"L {p[0]:.2f} {p[1]:.2f}")
    path_parts.append("Z")
    return " ".join(path_parts)


# ---------------------------------------------------------------------------
# ICON GENERATION
# ---------------------------------------------------------------------------

def generate_vortex_icon_svg(size, variant="core", with_glow=True):
    """Generate the vortex icon SVG at a given size."""
    cx, cy = size / 2, size / 2
    geom = ICON["geometry"]
    var_data = ICON["variants"][variant]
    
    outer_rx = geom["ellipseOuter"]["rxRatio"] * size
    outer_ry = geom["ellipseOuter"]["ryRatio"] * size
    rot = geom["ellipseOuter"]["rotationDeg"]
    
    outer_thick = geom["arcThickness"]["outerRatioToOuterRy"] * outer_ry
    inner_thick = geom["arcThickness"]["innerRatioToOuterRy"] * outer_ry
    
    core_rx = geom["coreCutout"]["rxRatio"] * size
    core_ry = geom["coreCutout"]["ryRatio"] * size
    core_rot = geom["coreCutout"]["rotationDeg"]
    
    ring_rx = (outer_rx + core_rx) / 2
    ring_ry = (outer_ry + core_ry) / 2
    ring_thick = outer_rx - core_rx
    
    taper = geom["tailTaper"]
    
    defs = []
    elements = []
    
    # Gradient defs based on variant
    if variant == "core":
        red_grad = find_gradient("redArcGradient")
        blue_grad = find_gradient("blueArcGradient")
        chrome_grad = find_gradient("chromeRingGradient")
        defs.append(svg_gradient_def(red_grad, "redArc"))
        defs.append(svg_gradient_def(blue_grad, "blueArc"))
        defs.append(svg_gradient_def(chrome_grad, "chromeCore"))
    elif variant == "energy":
        red_grad = find_gradient("redArcGradientStrong")
        chrome_grad = find_gradient("chromeRingGradient")
        defs.append(svg_gradient_def(red_grad, "redArc"))
        defs.append(svg_gradient_def(chrome_grad, "chromeCore"))
    elif variant == "trust":
        blue_grad = find_gradient("blueArcGradientStrong")
        chrome_grad = find_gradient("chromeRingGradient")
        defs.append(svg_gradient_def(blue_grad, "blueArc"))
        defs.append(svg_gradient_def(chrome_grad, "chromeCore"))
    elif variant == "premium":
        gold_grad = find_gradient("goldArcGradient")
        chrome_grad = find_gradient("chromeRingGradientWarm")
        defs.append(svg_gradient_def(gold_grad, "goldArc"))
        defs.append(svg_gradient_def(chrome_grad, "chromeCore"))
    elif variant == "monochromeWhite":
        mono_grad = find_gradient("monoWhiteGradient")
        defs.append(svg_gradient_def(mono_grad, "monoGrad"))
    elif variant == "monochromeDark":
        mono_grad = find_gradient("monoDarkGradient")
        defs.append(svg_gradient_def(mono_grad, "monoGrad"))
    
    # Glow filters
    if with_glow and "glow" in var_data:
        outer_glow = var_data["glow"].get("outer", {})
        for glow_name, glow_data in outer_glow.items():
            fid = f"glow_{glow_name}"
            defs.append(svg_glow_filter(fid, glow_data["color"],
                                         glow_data["blurPx"] * size / 1024,
                                         glow_data.get("spreadPx", 0),
                                         glow_data["opacity"]))
    
    # Shadow filter
    if geom["shadow"]["enabled"]:
        sh = geom["shadow"]
        scale = size / 1024
        defs.append(svg_drop_shadow_filter("iconShadow",
                                            sh["offset"]["x"] * scale,
                                            sh["offset"]["y"] * scale,
                                            sh["blurPx"] * scale,
                                            sh["color"], sh["opacity"]))
    
    # Specular filter
    spec = geom["specular"]["topHighlight"]
    defs.append(svg_gaussian_blur_filter("specBlur", spec["blurPx"] * size / 1024))
    
    defs_str = "\n".join(defs)
    
    # LAYER 1: Shadow ellipse
    if geom["shadow"]["enabled"]:
        elements.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{outer_rx}" ry="{outer_ry}" '
                        f'transform="rotate({rot} {cx} {cy})" '
                        f'fill="{C["graphiteBackground"]["hex"]}" opacity="0.6" filter="url(#iconShadow)"/>')
    
    # LAYER 2: Blue arc (back) / secondary arc
    if variant == "core":
        blue_path = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                      150, 380, outer_thick,
                                      taper["startThicknessRatio"], taper["endThicknessRatio"],
                                      taper["taperExponent"])
        elements.append(f'<path d="{blue_path}" fill="url(#blueArc)" opacity="0.9"/>')
    elif variant == "trust":
        blue_path = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                      -30, 200, outer_thick,
                                      taper["startThicknessRatio"], taper["endThicknessRatio"],
                                      taper["taperExponent"])
        blue_path2 = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                       150, 380, outer_thick,
                                       taper["startThicknessRatio"], taper["endThicknessRatio"],
                                       taper["taperExponent"])
        elements.append(f'<path d="{blue_path}" fill="url(#blueArc)" opacity="0.85"/>')
        elements.append(f'<path d="{blue_path2}" fill="url(#blueArc)" opacity="0.7"/>')
    
    # LAYER 3: Chrome core ring
    if variant in ("monochromeWhite", "monochromeDark"):
        fill = "url(#monoGrad)"
    else:
        fill = "url(#chromeCore)"
    
    elements.append(
        f'<ellipse cx="{cx}" cy="{cy}" rx="{ring_rx}" ry="{ring_ry}" '
        f'transform="rotate({rot} {cx} {cy})" '
        f'fill="none" stroke="{fill}" stroke-width="{ring_thick:.1f}" opacity="0.95"/>'
    )
    
    # LAYER 4: Red arc (front) / primary arc
    if variant == "core":
        red_path = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                     -30, 200, outer_thick,
                                     taper["startThicknessRatio"], taper["endThicknessRatio"],
                                     taper["taperExponent"])
        elements.append(f'<path d="{red_path}" fill="url(#redArc)" opacity="0.92"/>')
    elif variant == "energy":
        red_path = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                     -30, 200, outer_thick,
                                     taper["startThicknessRatio"], taper["endThicknessRatio"],
                                     taper["taperExponent"])
        red_path2 = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                      150, 380, outer_thick * 0.8,
                                      taper["startThicknessRatio"], taper["endThicknessRatio"],
                                      taper["taperExponent"])
        elements.append(f'<path d="{red_path}" fill="url(#redArc)" opacity="0.95"/>')
        elements.append(f'<path d="{red_path2}" fill="url(#redArc)" opacity="0.65"/>')
    elif variant == "premium":
        gold_path = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                      -30, 200, outer_thick,
                                      taper["startThicknessRatio"], taper["endThicknessRatio"],
                                      taper["taperExponent"])
        gold_path2 = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                       150, 380, outer_thick * 0.8,
                                       taper["startThicknessRatio"], taper["endThicknessRatio"],
                                       taper["taperExponent"])
        elements.append(f'<path d="{gold_path}" fill="url(#goldArc)" opacity="0.92"/>')
        elements.append(f'<path d="{gold_path2}" fill="url(#goldArc)" opacity="0.65"/>')
    elif variant in ("monochromeWhite", "monochromeDark"):
        mono_path = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                      -30, 200, outer_thick,
                                      taper["startThicknessRatio"], taper["endThicknessRatio"],
                                      taper["taperExponent"])
        mono_path2 = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                                       150, 380, outer_thick * 0.8,
                                       taper["startThicknessRatio"], taper["endThicknessRatio"],
                                       taper["taperExponent"])
        elements.append(f'<path d="{mono_path}" fill="url(#monoGrad)" opacity="0.9"/>')
        elements.append(f'<path d="{mono_path2}" fill="url(#monoGrad)" opacity="0.65"/>')
    
    # LAYER 5: Specular highlight
    spec_angle = spec["positionPolar"]["angleDeg"]
    spec_r = spec["positionPolar"]["radiusRatio"] * size / 2
    spec_x = cx + spec_r * math.cos(math.radians(spec_angle))
    spec_y = cy + spec_r * math.sin(math.radians(spec_angle))
    spec_size = spec["sizeRatio"] * size / 2
    elements.append(
        f'<circle cx="{spec_x:.1f}" cy="{spec_y:.1f}" r="{spec_size:.1f}" '
        f'fill="white" opacity="{spec["opacity"]}" filter="url(#specBlur)"/>'
    )
    
    # Inner rim highlight
    if geom["specular"]["innerRimHighlight"]["enabled"]:
        rim = geom["specular"]["innerRimHighlight"]
        rim_offset = rim["offsetRatio"] * size
        elements.append(
            f'<ellipse cx="{cx}" cy="{cy - rim_offset}" rx="{core_rx * 0.95}" ry="{core_ry * 0.95}" '
            f'transform="rotate({core_rot} {cx} {cy - rim_offset})" '
            f'fill="none" stroke="{C["silverHighlight"]["hex"]}" stroke-width="1.5" '
            f'opacity="{rim["opacity"]}" filter="url(#specBlur)"/>'
        )
    
    # LAYER 6: Outer glow (behind everything, but rendered after for SVG layering)
    glow_elements = []
    if with_glow and "glow" in var_data:
        outer_glow = var_data["glow"].get("outer", {})
        for glow_name, glow_data in outer_glow.items():
            fid = f"glow_{glow_name}"
            glow_elements.append(
                f'<ellipse cx="{cx}" cy="{cy}" rx="{outer_rx * 1.1}" ry="{outer_ry * 1.1}" '
                f'transform="rotate({rot} {cx} {cy})" '
                f'fill="{glow_data["color"]}" opacity="{glow_data["opacity"] * 0.6}" '
                f'filter="url(#{fid})"/>'
            )
    
    # LAYER 7: Particle specks
    particle_elements = []
    if variant == "core" and var_data.get("particleSpecks", {}).get("enabled"):
        ps = var_data["particleSpecks"]
        count = int(ps["countPer1024px"] * size / 1024)
        seed = hash("iTrader.im") % 10000
        import random
        rng = random.Random(seed)
        for i in range(count):
            angle = rng.uniform(0, 360)
            radius = rng.uniform(outer_rx * 0.6, outer_rx * 1.3)
            px = cx + radius * math.cos(math.radians(angle))
            py = cy + radius * math.sin(math.radians(angle))
            ps_size = rng.uniform(ps["sizePx"][0], ps["sizePx"][1]) * size / 1024
            ps_opacity = rng.uniform(ps["opacity"][0], ps["opacity"][1])
            particle_elements.append(
                f'<circle cx="{px:.1f}" cy="{py:.1f}" r="{ps_size:.1f}" '
                f'fill="white" opacity="{ps_opacity}"/>'
            )
    
    all_elements = glow_elements + elements + particle_elements
    
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
<defs>
{defs_str}
</defs>
{"".join(all_elements)}
</svg>'''
    return svg


# ---------------------------------------------------------------------------
# LOGO GENERATION
# ---------------------------------------------------------------------------

def generate_wordmark_svg(width, height, mode="dark", include_icon=True, include_tagline=True):
    """Generate the logo wordmark SVG."""
    props = LOGO["proportions"]
    
    defs = []
    elements = []
    
    # Gradient defs
    chrome_grad = find_gradient("chromeTextGradient")
    red_grad = find_gradient("redArcGradientStrong")
    white_grad = find_gradient("softWhiteGradient")
    red_streak_grad = find_gradient("redStreakGradient")
    
    defs.append(svg_gradient_def(chrome_grad, "chromeText"))
    defs.append(svg_gradient_def(red_grad, "redAccent"))
    defs.append(svg_gradient_def(white_grad, "whiteGrad"))
    defs.append(svg_gradient_def(red_streak_grad, "redStreak"))
    
    # Glow filters
    defs.append(svg_glow_filter("textGlow", "#FFFFFF", 10, 0, 0.18))
    defs.append(svg_glow_filter("redGlow", "#FF2436", 18, 0, 0.55))
    defs.append(svg_glow_filter("taglineGlow", "#FFFFFF", 6, 0, 0.12))
    
    is_dark = mode == "dark"
    
    if is_dark:
        vignette_grad = find_gradient("graphiteVignette")
        defs.append(svg_gradient_def(vignette_grad, "bgVignette"))
        elements.append(f'<rect width="{width}" height="{height}" fill="url(#bgVignette)"/>')
    
    # Icon area
    icon_w = width * props["iconToTotalWidth"] if include_icon else 0
    gap = width * props["gapIconToWordmark"] if include_icon else 0
    wordmark_x = icon_w + gap if include_icon else width * 0.05
    
    wordmark_font_size = height * 0.38
    wordmark_y = height * 0.52
    
    if is_dark:
        wordmark_fill = "url(#chromeText)"
        im_fill = "url(#redAccent)"
        tagline_fill = "url(#whiteGrad)"
    else:
        wordmark_fill = "#101114"
        im_fill = "#C7001A"
        tagline_fill = "#2B2C31"
    
    # Wordmark text
    italic_angle = props["italicAngleDeg"]
    skew_transform = f'skewX({italic_angle})'
    
    text_group = f'''<g transform="translate({wordmark_x:.1f}, {wordmark_y:.1f}) {skew_transform}" {'filter="url(#textGlow)"' if is_dark else ''}>
  <text font-family="'Montserrat', 'Eurostile', 'Bank Gothic', Arial, sans-serif" 
        font-weight="bold" font-size="{wordmark_font_size:.1f}" 
        letter-spacing="-1" fill="{wordmark_fill}" dominant-baseline="central">
    <tspan>iTrader</tspan><tspan fill="{im_fill}">.im</tspan>
  </text>
</g>'''
    elements.append(text_group)
    
    # Red underline streak
    if is_dark and LOGO["highlightEffects"]["redUnderlineStreak"]["enabled"]:
        streak = LOGO["highlightEffects"]["redUnderlineStreak"]
        sx = width * streak["start"]["x"]
        sy = height * streak["start"]["y"]
        ex = width * streak["end"]["x"]
        ey = height * streak["end"]["y"]
        streak_h = wordmark_font_size * streak["thicknessRatioToWordmarkCapHeight"]
        elements.append(
            f'<rect x="{sx:.1f}" y="{sy:.1f}" width="{ex - sx:.1f}" height="{streak_h:.1f}" '
            f'rx="{streak_h / 2:.1f}" fill="url(#redStreak)" opacity="{streak["opacity"]}" '
            f'filter="url(#redGlow)"/>'
        )
    
    # Tagline
    if include_tagline:
        tagline_size = wordmark_font_size * TYPO["supporting"]["tagline"]["sizeRatioToWordmark"]
        tagline_y = height * 0.83
        tagline_x = width * 0.5
        elements.append(
            f'<text x="{tagline_x:.1f}" y="{tagline_y:.1f}" text-anchor="middle" '
            f'font-family="\'Montserrat\', \'Gotham\', Arial, sans-serif" '
            f'font-weight="500" font-size="{tagline_size:.1f}" '
            f'letter-spacing="{TYPO["supporting"]["tagline"]["tracking"] / 100:.1f}" '
            f'fill="{tagline_fill}" opacity="0.9" '
            f'{"filter=\"url(#taglineGlow)\"" if is_dark else ""}>'
            f'BUY &bull; SELL &bull; UPGRADE</text>'
        )
    
    # Include vortex icon
    if include_icon:
        icon_size = height * 0.65
        icon_x = width * 0.02
        icon_y = (height - icon_size) / 2 - height * 0.05
        icon_svg_inner = generate_vortex_icon_svg(icon_size, "core", with_glow=is_dark)
        icon_inner = icon_svg_inner.split("<defs>")[1].split("</defs>")[0] if "<defs>" in icon_svg_inner else ""
        icon_body = icon_svg_inner.split("</defs>")[1].split("</svg>")[0] if "</defs>" in icon_svg_inner else ""
        defs.append(icon_inner)
        elements.append(f'<g transform="translate({icon_x:.1f}, {icon_y:.1f})">{icon_body}</g>')
    
    defs_str = "\n".join(defs)
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
<defs>
{defs_str}
</defs>
{"".join(elements)}
</svg>'''
    return svg


# ---------------------------------------------------------------------------
# BADGE GENERATION
# ---------------------------------------------------------------------------

def generate_badge_svg(badge_type):
    """Generate badge SVG from badgeSystem spec."""
    spec = BADGES[badge_type]
    w, h = 200, 44
    r = h * spec["cornerRadiusRatio"]
    
    defs = []
    elements = []
    
    fill_str = ""
    if "color" in spec["fill"]:
        fill_str = spec["fill"]["color"]
    elif "gradient" in spec["fill"]:
        grad = find_gradient(spec["fill"]["gradient"])
        if grad:
            defs.append(svg_gradient_def(grad, "badgeFill"))
            fill_str = "url(#badgeFill)"
    
    border_str = ""
    if "gradient" in spec["border"]:
        grad = find_gradient(spec["border"]["gradient"])
        if grad:
            defs.append(svg_gradient_def(grad, "badgeBorder"))
            border_str = "url(#badgeBorder)"
    elif "color" in spec["border"]:
        border_str = spec["border"]["color"]
    
    border_w = h * spec["border"]["widthRatio"]
    
    glow_spec = spec.get("glow", {})
    if glow_spec:
        preset = glow_spec.get("preset", "blue")
        glow_col = GLOW.get(preset, {}).get("color", "#3CAAFF")
        defs.append(svg_glow_filter("badgeGlow", glow_col,
                                     glow_spec.get("blurPx", 22),
                                     0, glow_spec.get("opacity", 0.35)))
    
    # Icon paths
    icon_type = spec["icon"]["type"]
    icon_x = w * spec["icon"]["placement"]["x"]
    icon_y = h * spec["icon"]["placement"]["y"]
    icon_s = h * spec["icon"]["scaleRatioToBadgeHeight"]
    
    icon_path = ""
    if icon_type == "checkmarkShield":
        icon_path = (f'<g transform="translate({icon_x - icon_s/2:.1f},{icon_y - icon_s/2:.1f}) scale({icon_s/24:.3f})">'
                    '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" fill="#FAFAFC"/></g>')
    elif icon_type == "star":
        icon_path = (f'<g transform="translate({icon_x - icon_s/2:.1f},{icon_y - icon_s/2:.1f}) scale({icon_s/24:.3f})">'
                    '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#FAFAFC"/></g>')
    elif icon_type == "crown":
        icon_path = (f'<g transform="translate({icon_x - icon_s/2:.1f},{icon_y - icon_s/2:.1f}) scale({icon_s/24:.3f})">'
                    '<path d="M2 19h20v3H2v-3zm1-9l5 3 4-5.5 4 5.5 5-3-1 9H4l-1-9z" fill="#0B0A0D"/></g>')
    
    text_x = w * spec["text"]["placement"]["x"]
    text_y = h * spec["text"]["placement"]["y"]
    text_color = spec["text"]["color"]
    
    labels = {"verifiedDealer": "VERIFIED DEALER", "featured": "FEATURED", "premium": "PREMIUM"}
    label = labels.get(badge_type, badge_type.upper())
    
    defs_str = "\n".join(defs)
    
    glow_attr = ' filter="url(#badgeGlow)"' if glow_spec else ""
    
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
<defs>
{defs_str}
</defs>
<rect x="0" y="0" width="{w}" height="{h}" rx="{r:.1f}" fill="{fill_str}" opacity="{spec["fill"]["opacity"]}"{glow_attr}/>
<rect x="{border_w/2:.1f}" y="{border_w/2:.1f}" width="{w - border_w:.1f}" height="{h - border_w:.1f}" rx="{r:.1f}" fill="none" stroke="{border_str}" stroke-width="{border_w:.1f}" opacity="{spec["border"]["opacity"]}"/>
{icon_path}
<text x="{text_x:.1f}" y="{text_y:.1f}" dominant-baseline="central" font-family="'Montserrat', Arial, sans-serif" font-weight="500" font-size="11" letter-spacing="1.6" fill="{text_color}">{label}</text>
</svg>'''
    return svg


# ---------------------------------------------------------------------------
# PLACEHOLDER GENERATION
# ---------------------------------------------------------------------------

def generate_placeholder_svg(ptype, w=400, h=300):
    """Generate placeholder SVGs with on-brand styling."""
    bg = C["carbonDark"]["hex"]
    border = C["slateSurface"]["hex"]
    accent = C["silverMetallic"]["hex"]
    
    defs = [svg_glow_filter("placeholderGlow", accent, 12, 0, 0.15)]
    
    icon_content = ""
    if ptype == "listing":
        icon_content = f'''<rect x="{w*0.3}" y="{h*0.25}" width="{w*0.4}" height="{h*0.35}" rx="8" fill="{border}" opacity="0.6"/>
<path d="M{w*0.42} {h*0.35} l{w*0.08} {h*0.08} l{w*0.08} -{h*0.12} l{w*0.06} {h*0.16} h-{w*0.3}" fill="{accent}" opacity="0.3"/>
<circle cx="{w*0.58}" cy="{h*0.33}" r="{min(w,h)*0.04}" fill="{accent}" opacity="0.3"/>'''
    elif ptype == "avatar":
        w, h = 200, 200
        icon_content = f'''<circle cx="{w/2}" cy="{h*0.38}" r="{w*0.15}" fill="{border}" opacity="0.6"/>
<ellipse cx="{w/2}" cy="{h*0.72}" rx="{w*0.22}" ry="{h*0.15}" fill="{border}" opacity="0.5"/>'''
    elif ptype == "dealer-logo":
        w, h = 300, 200
        icon_content = f'''<rect x="{w*0.2}" y="{h*0.2}" width="{w*0.6}" height="{h*0.6}" rx="12" fill="{border}" opacity="0.5"/>
<text x="{w/2}" y="{h/2}" text-anchor="middle" dominant-baseline="central" font-family="'Montserrat', sans-serif" font-size="14" fill="{accent}" opacity="0.5">DEALER</text>'''
    elif ptype.startswith("empty-state"):
        w, h = 400, 300
        sub = ptype.replace("empty-state-", "")
        messages = {"no-listings": "No listings found", "no-results": "No results", "no-messages": "No messages"}
        msg = messages.get(sub, "Empty")
        icon_content = f'''<circle cx="{w/2}" cy="{h*0.38}" r="36" fill="none" stroke="{border}" stroke-width="2" opacity="0.5"/>
<text x="{w/2}" y="{h*0.38}" text-anchor="middle" dominant-baseline="central" font-family="'Montserrat', sans-serif" font-size="28" fill="{accent}" opacity="0.35">?</text>
<text x="{w/2}" y="{h*0.62}" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="14" fill="{accent}" opacity="0.5" letter-spacing="1.5">{msg.upper()}</text>'''
    
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
<defs>
{defs[0]}
</defs>
<rect width="{w}" height="{h}" fill="{bg}" rx="8"/>
<rect x="1" y="1" width="{w-2}" height="{h-2}" rx="7" fill="none" stroke="{border}" stroke-width="1" opacity="0.5"/>
{icon_content}
</svg>'''
    return svg


# ---------------------------------------------------------------------------
# EFFECT GENERATION
# ---------------------------------------------------------------------------

def generate_streak_svg(direction="horizontal"):
    """Generate decorative streak SVGs."""
    if direction == "horizontal":
        w, h = 1024, 120
        spec = MOTION["horizontalStreak"]
        grad = find_gradient(spec["gradient"])
        blue_grad = find_gradient(spec["secondaryOverlay"]["gradient"]) if spec["secondaryOverlay"]["enabled"] else None
        
        defs = [svg_gradient_def(grad, "streakGrad")]
        if blue_grad:
            defs.append(svg_gradient_def(blue_grad, "streakGrad2"))
        defs.append(svg_gaussian_blur_filter("streakBlur", spec["edgeFeatherPxAt1024"]))
        
        thick = h * 0.5
        y_center = h / 2
        
        path = f'M 0 {y_center - thick/2} Q {w*0.1} {y_center - thick*0.6} {w*0.5} {y_center - thick*0.3} Q {w*0.9} {y_center - thick*0.1} {w} {y_center} L {w} {y_center} Q {w*0.9} {y_center + thick*0.1} {w*0.5} {y_center + thick*0.3} Q {w*0.1} {y_center + thick*0.6} 0 {y_center + thick/2} Z'
        
        elems = [f'<path d="{path}" fill="url(#streakGrad)" opacity="0.9" filter="url(#streakBlur)"/>']
        if blue_grad:
            offset_y = spec["secondaryOverlay"]["offsetRatio"]["y"] * h
            elems.append(f'<g transform="translate(0, {offset_y})"><path d="{path}" fill="url(#streakGrad2)" opacity="{spec["secondaryOverlay"]["opacity"]}" filter="url(#streakBlur)"/></g>')
        
        return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
<defs>{chr(10).join(defs)}</defs>
{"".join(elems)}
</svg>'''
    else:
        w, h = 120, 1024
        spec = MOTION["verticalStreak"]
        grad = find_gradient(spec["gradient"])
        red_grad = find_gradient(spec["secondaryOverlay"]["gradient"]) if spec["secondaryOverlay"]["enabled"] else None
        
        defs = [svg_gradient_def(grad, "streakGrad")]
        if red_grad:
            defs.append(svg_gradient_def(red_grad, "streakGrad2"))
        defs.append(svg_gaussian_blur_filter("streakBlur", spec["edgeFeatherPxAt1024"]))
        
        thick = w * 0.5
        x_center = w / 2
        
        path = f'M {x_center - thick/2} 0 Q {x_center - thick*0.6} {h*0.1} {x_center - thick*0.3} {h*0.5} Q {x_center - thick*0.1} {h*0.9} {x_center} {h} L {x_center} {h} Q {x_center + thick*0.1} {h*0.9} {x_center + thick*0.3} {h*0.5} Q {x_center + thick*0.6} {h*0.1} {x_center + thick/2} 0 Z'
        
        elems = [f'<path d="{path}" fill="url(#streakGrad)" opacity="0.85" filter="url(#streakBlur)"/>']
        if red_grad:
            offset_x = spec["secondaryOverlay"]["offsetRatio"]["x"] * w
            elems.append(f'<g transform="translate({offset_x}, 0)"><path d="{path}" fill="url(#streakGrad2)" opacity="{spec["secondaryOverlay"]["opacity"]}" filter="url(#streakBlur)"/></g>')
        
        return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
<defs>{chr(10).join(defs)}</defs>
{"".join(elems)}
</svg>'''


def generate_noise_svg():
    """Generate seamlessly tileable noise texture SVG."""
    return '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<filter id="noise">
  <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" stitchTiles="stitch"/>
  <feColorMatrix type="saturate" values="0"/>
</filter>
<rect width="256" height="256" fill="transparent"/>
<rect width="256" height="256" filter="url(#noise)" opacity="0.08"/>
</svg>'''


# ---------------------------------------------------------------------------
# SPINNER / LOADING GENERATION
# ---------------------------------------------------------------------------

def generate_spinner_svg(preset="default"):
    """Generate CSS-animated spinner SVGs."""
    size = 64
    cx, cy = size / 2, size / 2
    r = 24
    stroke_w = 4
    
    color_map = {
        "energy": (C["neonRed"]["hex"], C["accentStreakRed"]["hex"]),
        "trust": (C["electricBlue"]["hex"], C["accentStreakBlue"]["hex"]),
        "default": (C["silverMetallic"]["hex"], C["silverHighlight"]["hex"]),
    }
    col1, col2 = color_map.get(preset, color_map["default"])
    
    glow_col = col1
    glow_opacity = 0.4
    
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
<defs>
  <filter id="spinGlow" x="-50%" y="-50%" width="200%" height="200%">
    <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="{glow_col}" flood-opacity="{glow_opacity}"/>
  </filter>
</defs>
<style>
  @keyframes spin {{ from {{ transform: rotate(0deg); }} to {{ transform: rotate(360deg); }} }}
  .spinner {{ animation: spin 1s linear infinite; transform-origin: {cx}px {cy}px; }}
</style>
<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{col1}" stroke-width="{stroke_w}" 
        stroke-dasharray="{r * math.pi * 1.2:.1f} {r * math.pi * 0.8:.1f}" 
        stroke-linecap="round" class="spinner" filter="url(#spinGlow)" opacity="0.9"/>
<circle cx="{cx}" cy="{cy}" r="{r - 6}" fill="none" stroke="{col2}" stroke-width="2" 
        stroke-dasharray="{(r-6) * math.pi * 0.6:.1f} {(r-6) * math.pi * 1.4:.1f}" 
        stroke-linecap="round" class="spinner" opacity="0.5"
        style="animation-direction: reverse; animation-duration: 1.4s;"/>
</svg>'''


def generate_logo_animated_svg():
    """Generate the animated logo loader SVG."""
    size = 120
    icon_svg = generate_vortex_icon_svg(80, "core", with_glow=True)
    icon_inner = icon_svg.split("<defs>")[1].split("</defs>")[0] if "<defs>" in icon_svg else ""
    icon_body = icon_svg.split("</defs>")[1].split("</svg>")[0] if "</defs>" in icon_svg else ""
    
    anim = MOTION["suggestedAnimation"]
    pulse = anim["iconPulse"]
    
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
<defs>
{icon_inner}
</defs>
<style>
@keyframes pulse {{
  0%, 100% {{ transform: scale(1); opacity: 0.45; }}
  50% {{ transform: scale(1.03); opacity: 0.62; }}
}}
@keyframes streakSweep {{
  0% {{ transform: translateX(-35%); opacity: 0; }}
  15% {{ transform: translateX(-5%); opacity: 0.85; }}
  55% {{ transform: translateX(35%); opacity: 0.85; }}
  100% {{ transform: translateX(85%); opacity: 0; }}
}}
.icon-pulse {{
  animation: pulse {pulse["durationMs"]}ms ease-in-out infinite;
  transform-origin: {size/2}px {size/2}px;
}}
</style>
<g class="icon-pulse" transform="translate({(size-80)/2}, {(size-80)/2})">
{icon_body}
</g>
</svg>'''


# ---------------------------------------------------------------------------
# PAYMENT BADGES
# ---------------------------------------------------------------------------

def generate_payment_badge_svg(ptype):
    """Generate payment badge SVGs."""
    w, h = 120, 36
    bg = C["carbonDark"]["hex"]
    border = C["slateSurface"]["hex"]
    text_col = C["pureWhite"]["hex"]
    
    if ptype == "stripe":
        label = "STRIPE"
        accent = "#635BFF"
    else:
        label = "SECURE"
        accent = "#4CAF50"
    
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
<rect width="{w}" height="{h}" rx="{h/2}" fill="{bg}" opacity="0.9"/>
<rect x="1" y="1" width="{w-2}" height="{h-2}" rx="{(h-2)/2}" fill="none" stroke="{border}" opacity="0.7"/>
<circle cx="18" cy="{h/2}" r="8" fill="{accent}" opacity="0.85"/>
<text x="{w/2 + 8}" y="{h/2}" text-anchor="middle" dominant-baseline="central" 
      font-family="'Montserrat', sans-serif" font-weight="600" font-size="10" 
      letter-spacing="1.8" fill="{text_col}">{label}</text>
</svg>'''


# ---------------------------------------------------------------------------
# CATEGORY EXPRESSION GENERATION (PNG via Pillow)
# ---------------------------------------------------------------------------

def generate_category_png(cat_name, w, h):
    """Generate category expression banner as PNG using Pillow."""
    if not HAS_PILLOW:
        return None
    
    cat = CATEGORIES.get(cat_name)
    if not cat:
        cat = CATEGORIES.get("vehicles")
    
    img = Image.new("RGBA", (w, h), (5, 4, 5, 255))
    draw = ImageDraw.Draw(img)
    
    accent_hex = color(cat["primaryAccent"])
    accent_r, accent_g, accent_b = int(accent_hex[1:3], 16), int(accent_hex[3:5], 16), int(accent_hex[5:7], 16)
    
    for y in range(h):
        ratio = y / h
        overlay_opacity = 0.55 if ratio < 0.3 else (0.15 if ratio < 0.7 else 0.55)
        r = int(5 * (1 - overlay_opacity))
        g = int(4 * (1 - overlay_opacity))
        b = int(5 * (1 - overlay_opacity))
        draw.line([(0, y), (w, y)], fill=(r, g, b, 255))
    
    streak_y = int(h * 0.5)
    streak_h = int(h * cat.get("motionStreak", {}).get("thicknessRatio", 0.1))
    for dy in range(streak_h):
        dist = abs(dy - streak_h / 2) / (streak_h / 2)
        opacity = int((1 - dist ** 2) * 180)
        blend = max(0, min(255, opacity))
        draw.line([(0, streak_y + dy), (w, streak_y + dy)],
                  fill=(accent_r, accent_g, accent_b, blend))
    
    glow_radius = max(w, h) // 4
    glow_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_draw.ellipse([w // 2 - glow_radius, h // 2 - glow_radius,
                        w // 2 + glow_radius, h // 2 + glow_radius],
                       fill=(accent_r, accent_g, accent_b, 40))
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=glow_radius // 2))
    img = Image.alpha_composite(img, glow_img)
    
    draw = ImageDraw.Draw(img)
    
    lp = cat.get("logoPlacementRatio", {"x": 0.09, "y": 0.22})
    text_x = int(w * lp["x"])
    text_y = int(h * lp["y"])
    
    try:
        font_large = ImageFont.truetype("arial.ttf", max(28, h // 14))
        font_small = ImageFont.truetype("arial.ttf", max(14, h // 28))
    except (OSError, IOError):
        font_large = ImageFont.load_default()
        font_small = ImageFont.load_default()
    
    draw.text((text_x, text_y), "iTrader", fill=(239, 240, 243, 255), font=font_large)
    im_x = text_x + font_large.getlength("iTrader") if hasattr(font_large, 'getlength') else text_x + 180
    draw.text((im_x, text_y), ".im", fill=(226, 34, 41, 255), font=font_large)
    
    cat_labels = {
        "vehicles": "VEHICLES",
        "hifiAv": "HI-FI & AV",
        "watches": "WATCHES",
        "luxury": "LUXURY",
        "default": "MARKETPLACE"
    }
    label = cat_labels.get(cat_name, "MARKETPLACE")
    draw.text((text_x, text_y + h // 10), label, fill=(250, 250, 252, 200), font=font_small)
    
    tagline_y = int(h * 0.83)
    draw.text((w // 2 - 80, tagline_y), "BUY \u2022 SELL \u2022 UPGRADE",
              fill=(207, 207, 212, 180), font=font_small)
    
    return img


# ---------------------------------------------------------------------------
# OG IMAGE GENERATION (PNG via Pillow)
# ---------------------------------------------------------------------------

def generate_og_image(variant="default", w=1200, h=630):
    """Generate Open Graph image using Pillow."""
    if not HAS_PILLOW:
        return None
    
    img = Image.new("RGBA", (w, h), (5, 4, 5, 255))
    draw = ImageDraw.Draw(img)
    
    for y in range(h):
        ratio = y / h
        v = int(5 + 6 * math.sin(ratio * math.pi))
        draw.line([(0, y), (w, y)], fill=(v, v - 1, v + 2, 255))
    
    for x in range(w):
        ratio = x / w
        edge_fade = min(ratio, 1 - ratio) * 2
        opacity = int((1 - edge_fade) * 40)
        if opacity > 0:
            draw.line([(x, 0), (x, h)], fill=(0, 0, 0, opacity))
    
    streak_y = h // 2 + 30
    streak_h = 12
    for dy in range(streak_h):
        dist = abs(dy - streak_h / 2) / (streak_h / 2)
        opacity = int((1 - dist ** 2) * 120)
        draw.line([(w * 0.15, streak_y + dy), (w * 0.85, streak_y + dy)],
                  fill=(226, 34, 41, opacity))
    
    blue_glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blue_glow)
    bd.ellipse([w // 2 - 200, h // 2 - 100, w // 2 + 200, h // 2 + 100],
               fill=(21, 123, 202, 25))
    blue_glow = blue_glow.filter(ImageFilter.GaussianBlur(radius=80))
    img = Image.alpha_composite(img, blue_glow)
    
    draw = ImageDraw.Draw(img)
    
    try:
        font_brand = ImageFont.truetype("arial.ttf", 52)
        font_tag = ImageFont.truetype("arial.ttf", 18)
    except (OSError, IOError):
        font_brand = ImageFont.load_default()
        font_tag = ImageFont.load_default()
    
    brand_text = "iTrader.im"
    if hasattr(font_brand, 'getlength'):
        tw = font_brand.getlength(brand_text)
    else:
        tw = 300
    tx = (w - tw) / 2
    ty = h * 0.38
    
    draw.text((tx, ty), "iTrader", fill=(239, 240, 243, 255), font=font_brand)
    im_offset = font_brand.getlength("iTrader") if hasattr(font_brand, 'getlength') else 220
    draw.text((tx + im_offset, ty), ".im", fill=(226, 34, 41, 255), font=font_brand)
    
    tag = "BUY \u2022 SELL \u2022 UPGRADE"
    if hasattr(font_tag, 'getlength'):
        ttw = font_tag.getlength(tag)
    else:
        ttw = 200
    draw.text(((w - ttw) / 2, h * 0.58), tag, fill=(207, 207, 212, 200), font=font_tag)
    
    if variant == "listing":
        draw.text((w * 0.1, h * 0.78), "LISTING DETAILS", fill=(183, 172, 170, 120), font=font_tag)
    elif variant == "categories":
        draw.text((w * 0.1, h * 0.78), "BROWSE CATEGORIES", fill=(183, 172, 170, 120), font=font_tag)
    
    return img


# ---------------------------------------------------------------------------
# FAVICON ICO GENERATION
# ---------------------------------------------------------------------------

def create_ico(images_dict, output_path):
    """Create a .ico file from a dict of {size: PIL.Image}."""
    if not HAS_PILLOW:
        return
    
    sizes = sorted(images_dict.keys())
    entries = []
    image_data_list = []
    offset = 6 + 16 * len(sizes)
    
    for sz in sizes:
        img = images_dict[sz].convert("RGBA").resize((sz, sz), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format="PNG")
        png_data = buf.getvalue()
        
        entry = struct.pack('<BBBBHHII',
                           sz if sz < 256 else 0,
                           sz if sz < 256 else 0,
                           0, 0, 1, 32,
                           len(png_data), offset)
        entries.append(entry)
        image_data_list.append(png_data)
        offset += len(png_data)
    
    with open(output_path, 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, len(sizes)))
        for e in entries:
            f.write(e)
        for d in image_data_list:
            f.write(d)


# ---------------------------------------------------------------------------
# CARBON FIBER PATTERN (PNG via Pillow)
# ---------------------------------------------------------------------------

def generate_carbon_fiber_png(size=256):
    if not HAS_PILLOW:
        return None
    img = Image.new("RGBA", (size, size), (15, 13, 16, 255))
    draw = ImageDraw.Draw(img)
    cell = 8
    for y in range(0, size, cell):
        for x in range(0, size, cell):
            checker = ((x // cell) + (y // cell)) % 2
            if checker == 0:
                draw.rectangle([x, y, x + cell - 1, y + cell - 1],
                              fill=(18, 16, 20, 255))
            else:
                draw.rectangle([x, y, x + cell - 1, y + cell - 1],
                              fill=(12, 10, 14, 255))
            draw.line([(x, y), (x + cell - 1, y)], fill=(25, 24, 28, 80))
            draw.line([(x, y), (x, y + cell - 1)], fill=(25, 24, 28, 60))
    return img


def generate_glass_noise_png(size=256):
    if not HAS_PILLOW:
        return None
    import random
    rng = random.Random(42)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            v = rng.randint(0, 255)
            a = rng.randint(5, 25)
            pixels[x, y] = (v, v, v, a)
    return img


# ---------------------------------------------------------------------------
# SVG to PNG CONVERSION
# ---------------------------------------------------------------------------

def svg_to_png(svg_content, width, height, output_path):
    """Convert SVG string to PNG file."""
    if HAS_CAIRO:
        try:
            cairosvg.svg2png(bytestring=svg_content.encode("utf-8"),
                            write_to=output_path,
                            output_width=width,
                            output_height=height)
            return True
        except Exception as e:
            print(f"  CairoSVG failed for {output_path}: {e}")
    
    if HAS_PILLOW:
        try:
            img = Image.new("RGBA", (width, height), (5, 4, 5, 255))
            draw = ImageDraw.Draw(img)
            draw.rectangle([width * 0.1, height * 0.1, width * 0.9, height * 0.9],
                          fill=(18, 19, 24, 200))
            try:
                font = ImageFont.truetype("arial.ttf", max(12, width // 20))
            except (OSError, IOError):
                font = ImageFont.load_default()
            draw.text((width * 0.15, height * 0.4), "iTrader.im",
                     fill=(239, 240, 243, 255), font=font)
            img.save(output_path, "PNG")
            return True
        except Exception as e:
            print(f"  Pillow fallback failed for {output_path}: {e}")
    return False


def svg_to_pil(svg_content, width, height):
    """Convert SVG to PIL Image object."""
    if HAS_CAIRO:
        try:
            png_data = cairosvg.svg2png(bytestring=svg_content.encode("utf-8"),
                                         output_width=width, output_height=height)
            return Image.open(BytesIO(png_data)).convert("RGBA")
        except Exception:
            pass
    if HAS_PILLOW:
        img = Image.new("RGBA", (width, height), (5, 4, 5, 255))
        return img
    return None


# ---------------------------------------------------------------------------
# WEBMANIFEST
# ---------------------------------------------------------------------------

def generate_webmanifest():
    return json.dumps({
        "name": "iTrader.im",
        "short_name": "iTrader",
        "description": "BUY \u2022 SELL \u2022 UPGRADE - Isle of Man Marketplace",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#050405",
        "theme_color": "#E22229",
        "icons": [
            {"src": "/favicon/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/favicon/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/favicon/icon.svg", "type": "image/svg+xml", "sizes": "any"}
        ]
    }, indent=2)


# ---------------------------------------------------------------------------
# SAFARI PINNED TAB
# ---------------------------------------------------------------------------

def generate_safari_pinned_tab_svg():
    """Single-color SVG for Safari pinned tabs."""
    size = 512
    cx, cy = size / 2, size / 2
    geom = ICON["geometry"]
    outer_rx = geom["ellipseOuter"]["rxRatio"] * size
    outer_ry = geom["ellipseOuter"]["ryRatio"] * size
    rot = geom["ellipseOuter"]["rotationDeg"]
    outer_thick = geom["arcThickness"]["outerRatioToOuterRy"] * outer_ry
    taper = geom["tailTaper"]
    
    path1 = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                              -30, 200, outer_thick,
                              taper["startThicknessRatio"], taper["endThicknessRatio"],
                              taper["taperExponent"])
    path2 = tapered_arc_path(cx, cy, outer_rx, outer_ry, rot,
                              150, 380, outer_thick * 0.8,
                              taper["startThicknessRatio"], taper["endThicknessRatio"],
                              taper["taperExponent"])
    
    core_rx = geom["coreCutout"]["rxRatio"] * size
    core_ry = geom["coreCutout"]["ryRatio"] * size
    ring_rx = (outer_rx + core_rx) / 2
    ring_ry = (outer_ry + core_ry) / 2
    ring_thick = outer_rx - core_rx
    
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
<ellipse cx="{cx}" cy="{cy}" rx="{ring_rx}" ry="{ring_ry}" transform="rotate({rot} {cx} {cy})" fill="none" stroke="black" stroke-width="{ring_thick:.1f}"/>
<path d="{path1}" fill="black"/>
<path d="{path2}" fill="black"/>
</svg>'''


# ---------------------------------------------------------------------------
# MAIN GENERATION
# ---------------------------------------------------------------------------

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def main():
    print("=" * 60)
    print("iTrader.im Brand Asset Generator")
    print("=" * 60)
    
    base = OUTPUT_DIR
    dirs = ["logo", "icon", "favicon", "app", "category", "og", "badges",
            "placeholders", "effects", "spinners", "email", "legal", "manifest"]
    for d in dirs:
        ensure_dir(base / d)
    
    generated_files = []
    
    # -----------------------------------------------------------------------
    # 1. LOGOS
    # -----------------------------------------------------------------------
    print("\n[1/10] Generating logos...")
    
    logo_configs = [
        ("logo-full-dark.svg", 1200, 400, "dark", True, True),
        ("logo-full-light.svg", 1200, 400, "light", True, True),
        ("logo-compact-dark.svg", 400, 140, "dark", True, False),
        ("logo-compact-light.svg", 400, 140, "light", True, False),
        ("logo-wordmark.svg", 800, 200, "dark", False, False),
        ("logo-wordmark-light.svg", 800, 200, "light", False, False),
    ]
    
    for fname, w, h, mode, icon, tagline in logo_configs:
        svg = generate_wordmark_svg(w, h, mode, icon, tagline)
        path = base / "logo" / fname
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg)
        generated_files.append(str(path.relative_to(base)))
        print(f"  Created {fname}")
    
    # PNG exports
    for svg_name, png_w in [("logo-full-dark.svg", 1200), ("logo-full-light.svg", 1200),
                             ("logo-compact-dark.svg", 400), ("logo-compact-light.svg", 400)]:
        svg_path = base / "logo" / svg_name
        with open(svg_path, "r", encoding="utf-8") as f:
            svg_content = f.read()
        
        png_name = svg_name.replace(".svg", ".png")
        aspect = 400 / 1200 if "full" in svg_name else 140 / 400
        png_h = int(png_w * aspect)
        png_path = base / "logo" / png_name
        if svg_to_png(svg_content, png_w, png_h, str(png_path)):
            generated_files.append(str(png_path.relative_to(base)))
            print(f"  Created {png_name}")
    
    # -----------------------------------------------------------------------
    # 2. ICON SYSTEM
    # -----------------------------------------------------------------------
    print("\n[2/10] Generating icon system...")
    
    icon_variants = ["core", "energy", "trust", "premium", "monochromeWhite", "monochromeDark"]
    icon_file_names = ["icon-core", "icon-energy", "icon-trust", "icon-premium",
                       "icon-monochrome-white", "icon-monochrome-dark"]
    icon_sizes = [1024, 512, 256, 128, 64, 32]
    
    for variant, fname_base in zip(icon_variants, icon_file_names):
        svg = generate_vortex_icon_svg(1024, variant, with_glow=True)
        svg_path = base / "icon" / f"{fname_base}.svg"
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        generated_files.append(str(svg_path.relative_to(base)))
        print(f"  Created {fname_base}.svg")
        
        for sz in icon_sizes:
            png_path = base / "icon" / f"{fname_base}-{sz}.png"
            if svg_to_png(svg, sz, sz, str(png_path)):
                generated_files.append(str(png_path.relative_to(base)))
        print(f"  Created {fname_base} PNGs ({', '.join(str(s) for s in icon_sizes)})")
    
    # -----------------------------------------------------------------------
    # 3. FAVICONS & APP ICONS
    # -----------------------------------------------------------------------
    print("\n[3/10] Generating favicons and app icons...")
    
    icon_svg = generate_vortex_icon_svg(512, "core", with_glow=False)
    
    svg_path = base / "favicon" / "icon.svg"
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(icon_svg)
    generated_files.append(str(svg_path.relative_to(base)))
    
    favicon_sizes = {"icon.png": 32, "apple-icon.png": 180,
                     "android-chrome-192x192.png": 192, "android-chrome-512x512.png": 512,
                     "mstile-150x150.png": 150}
    
    pil_icons = {}
    for fname, sz in favicon_sizes.items():
        png_path = base / "favicon" / fname
        if svg_to_png(icon_svg, sz, sz, str(png_path)):
            generated_files.append(str(png_path.relative_to(base)))
            print(f"  Created {fname}")
        pil_img = svg_to_pil(icon_svg, sz, sz)
        if pil_img:
            pil_icons[sz] = pil_img
    
    ico_path = base / "favicon" / "favicon.ico"
    ico_images = {}
    for sz in [16, 32, 48]:
        pil_img = svg_to_pil(icon_svg, sz, sz)
        if pil_img:
            ico_images[sz] = pil_img
    if ico_images:
        create_ico(ico_images, str(ico_path))
        generated_files.append(str(ico_path.relative_to(base)))
        print("  Created favicon.ico")
    
    safari_svg = generate_safari_pinned_tab_svg()
    safari_path = base / "favicon" / "safari-pinned-tab.svg"
    with open(safari_path, "w", encoding="utf-8") as f:
        f.write(safari_svg)
    generated_files.append(str(safari_path.relative_to(base)))
    print("  Created safari-pinned-tab.svg")
    
    # -----------------------------------------------------------------------
    # 4. APP ICON VARIANTS
    # -----------------------------------------------------------------------
    print("\n[4/10] Generating app icon variants...")
    
    app_bg_grad = find_gradient("appIconBackground")
    
    for app_variant in ["vortexOnly", "monogramIT"]:
        app_size = 1024
        
        if app_variant == "vortexOnly":
            inner_icon = generate_vortex_icon_svg(int(app_size * 0.72), "core", with_glow=True)
            icon_inner_defs = inner_icon.split("<defs>")[1].split("</defs>")[0] if "<defs>" in inner_icon else ""
            icon_inner_body = inner_icon.split("</defs>")[1].split("</svg>")[0] if "</defs>" in inner_icon else ""
            
            corner_r = app_size * APP_ICON["container"]["cornerRadiusPct"] / 100
            
            defs = [svg_gradient_def(app_bg_grad, "appBg"), icon_inner_defs]
            defs.append(svg_glow_filter("edgeGlow", "#FFFFFF", app_size * 0.06, 0, 0.22))
            
            offset_y = app_size * APP_ICON["iconPlacement"]["centerOffsetPct"]["y"] / 100
            icon_offset = (app_size - app_size * 0.72) / 2
            
            svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {app_size} {app_size}" width="{app_size}" height="{app_size}">
<defs>
{chr(10).join(defs)}
<clipPath id="appClip"><rect width="{app_size}" height="{app_size}" rx="{corner_r:.1f}"/></clipPath>
</defs>
<g clip-path="url(#appClip)">
<rect width="{app_size}" height="{app_size}" rx="{corner_r:.1f}" fill="url(#appBg)"/>
<rect x="2" y="2" width="{app_size-4}" height="{app_size-4}" rx="{corner_r-2:.1f}" fill="none" stroke="{C['slateSurface']['hex']}" stroke-width="2" opacity="0.9"/>
<g transform="translate({icon_offset:.1f}, {icon_offset + offset_y:.1f})">
{icon_inner_body}
</g>
</g>
</svg>'''
        else:
            corner_r = app_size * APP_ICON["container"]["cornerRadiusPct"] / 100
            chrome_grad = find_gradient("chromeTextGradient")
            defs = [svg_gradient_def(app_bg_grad, "appBg"),
                    svg_gradient_def(chrome_grad, "chromeText")]
            
            svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {app_size} {app_size}" width="{app_size}" height="{app_size}">
<defs>
{chr(10).join(defs)}
<clipPath id="appClip"><rect width="{app_size}" height="{app_size}" rx="{corner_r:.1f}"/></clipPath>
</defs>
<g clip-path="url(#appClip)">
<rect width="{app_size}" height="{app_size}" rx="{corner_r:.1f}" fill="url(#appBg)"/>
<rect x="2" y="2" width="{app_size-4}" height="{app_size-4}" rx="{corner_r-2:.1f}" fill="none" stroke="{C['slateSurface']['hex']}" stroke-width="2" opacity="0.9"/>
<text x="{app_size/2}" y="{app_size/2}" text-anchor="middle" dominant-baseline="central"
      font-family="'Montserrat', 'Eurostile', sans-serif" font-weight="bold" font-size="{app_size * 0.4}"
      font-style="italic" fill="url(#chromeText)">iT</text>
<rect x="{app_size * 0.55}" y="{app_size * 0.62}" width="{app_size * 0.12}" height="{app_size * 0.032}" rx="4" fill="{C['neonRed']['hex']}" opacity="0.9"/>
</g>
</svg>'''
        
        svg_out = base / "app" / f"app-icon-{app_variant.lower()}.svg"
        with open(svg_out, "w", encoding="utf-8") as f:
            f.write(svg)
        generated_files.append(str(svg_out.relative_to(base)))
        
        for sz in [1024, 512, 256, 128]:
            png_path = base / "app" / f"app-icon-{app_variant.lower()}-{sz}.png"
            if svg_to_png(svg, sz, sz, str(png_path)):
                generated_files.append(str(png_path.relative_to(base)))
        print(f"  Created app-icon-{app_variant.lower()} (SVG + PNGs)")
    
    # -----------------------------------------------------------------------
    # 5. CATEGORY EXPRESSIONS
    # -----------------------------------------------------------------------
    print("\n[5/10] Generating category expressions...")
    
    cat_configs = [
        ("vehicles", "category-vehicles"),
        ("hifiAv", "category-hifi-av"),
        ("watches", "category-watches"),
        ("luxury", "category-luxury"),
        ("vehicles", "category-default"),
    ]
    
    for cat_key, fname_base in cat_configs:
        for w, h, suffix in [(1920, 1080, ""), (1200, 630, "-og")]:
            img = generate_category_png(cat_key, w, h)
            if img:
                png_path = base / "category" / f"{fname_base}{suffix}.png"
                img.save(str(png_path), "PNG")
                generated_files.append(str(png_path.relative_to(base)))
        print(f"  Created {fname_base} (1920x1080 + 1200x630)")
    
    # -----------------------------------------------------------------------
    # 6. OPEN GRAPH IMAGES
    # -----------------------------------------------------------------------
    print("\n[6/10] Generating OG images...")
    
    og_configs = [
        ("opengraph-image.png", "default", 1200, 630),
        ("opengraph-image-listing.png", "listing", 1200, 630),
        ("opengraph-image-categories.png", "categories", 1200, 630),
        ("twitter-image.png", "default", 1200, 600),
    ]
    
    for fname, variant, w, h in og_configs:
        img = generate_og_image(variant, w, h)
        if img:
            png_path = base / "og" / fname
            img.save(str(png_path), "PNG")
            generated_files.append(str(png_path.relative_to(base)))
            print(f"  Created {fname}")
    
    # -----------------------------------------------------------------------
    # 7. BADGES
    # -----------------------------------------------------------------------
    print("\n[7/10] Generating badges...")
    
    for badge_type, fname in [("verifiedDealer", "badge-verified-dealer"),
                               ("featured", "badge-featured"),
                               ("premium", "badge-premium")]:
        svg = generate_badge_svg(badge_type)
        svg_path = base / "badges" / f"{fname}.svg"
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        generated_files.append(str(svg_path.relative_to(base)))
        print(f"  Created {fname}.svg")
    
    for ptype, fname in [("stripe", "payment-stripe"), ("secure", "payment-secure")]:
        svg = generate_payment_badge_svg(ptype)
        svg_path = base / "badges" / f"{fname}.svg"
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        generated_files.append(str(svg_path.relative_to(base)))
        print(f"  Created {fname}.svg")
    
    # -----------------------------------------------------------------------
    # 8. PLACEHOLDERS
    # -----------------------------------------------------------------------
    print("\n[8/10] Generating placeholders...")
    
    placeholder_configs = [
        ("listing", "placeholder-listing"),
        ("avatar", "placeholder-avatar"),
        ("dealer-logo", "placeholder-dealer-logo"),
        ("empty-state-no-listings", "empty-state-no-listings"),
        ("empty-state-no-results", "empty-state-no-results"),
        ("empty-state-no-messages", "empty-state-no-messages"),
    ]
    
    for ptype, fname in placeholder_configs:
        svg = generate_placeholder_svg(ptype)
        svg_path = base / "placeholders" / f"{fname}.svg"
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        generated_files.append(str(svg_path.relative_to(base)))
        print(f"  Created {fname}.svg")
    
    # -----------------------------------------------------------------------
    # 9. EFFECTS
    # -----------------------------------------------------------------------
    print("\n[9/10] Generating effects & spinners...")
    
    for direction, fname in [("horizontal", "gradient-streak-horizontal"),
                              ("vertical", "gradient-streak-vertical")]:
        svg = generate_streak_svg(direction)
        svg_path = base / "effects" / f"{fname}.svg"
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        generated_files.append(str(svg_path.relative_to(base)))
        print(f"  Created {fname}.svg")
    
    noise_svg = generate_noise_svg()
    noise_path = base / "effects" / "noise-texture.svg"
    with open(noise_path, "w", encoding="utf-8") as f:
        f.write(noise_svg)
    generated_files.append(str(noise_path.relative_to(base)))
    print("  Created noise-texture.svg")
    
    carbon = generate_carbon_fiber_png()
    if carbon:
        carbon_path = base / "effects" / "carbon-fiber-pattern.png"
        carbon.save(str(carbon_path), "PNG")
        generated_files.append(str(carbon_path.relative_to(base)))
        print("  Created carbon-fiber-pattern.png")
    
    glass = generate_glass_noise_png()
    if glass:
        glass_path = base / "effects" / "glass-noise.png"
        glass.save(str(glass_path), "PNG")
        generated_files.append(str(glass_path.relative_to(base)))
        print("  Created glass-noise.png")
    
    # Spinners
    for preset in ["energy", "trust", "default"]:
        svg = generate_spinner_svg(preset)
        svg_path = base / "spinners" / f"spinner-{preset}.svg"
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        generated_files.append(str(svg_path.relative_to(base)))
        print(f"  Created spinner-{preset}.svg")
    
    anim_svg = generate_logo_animated_svg()
    anim_path = base / "spinners" / "logo-animated.svg"
    with open(anim_path, "w", encoding="utf-8") as f:
        f.write(anim_svg)
    generated_files.append(str(anim_path.relative_to(base)))
    print("  Created logo-animated.svg")
    
    # -----------------------------------------------------------------------
    # 10. EMAIL, MANIFEST, LEGAL
    # -----------------------------------------------------------------------
    print("\n[10/10] Generating email, manifest, legal...")
    
    # Email assets
    email_logo_svg = generate_wordmark_svg(600, 200, "dark", True, False)
    for fname, ew in [("email-header-logo.png", 600), ("email-footer-logo.png", 400)]:
        eh = int(ew * 200 / 600)
        png_path = base / "email" / fname
        if svg_to_png(email_logo_svg, ew, eh, str(png_path)):
            generated_files.append(str(png_path.relative_to(base)))
            print(f"  Created {fname}")
    
    # Webmanifest
    manifest = generate_webmanifest()
    manifest_path = base / "manifest" / "site.webmanifest"
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(manifest)
    generated_files.append(str(manifest_path.relative_to(base)))
    print("  Created site.webmanifest")
    
    # Legal placeholder
    legal_path = base / "legal" / "brand-usage-guidelines.txt"
    with open(legal_path, "w", encoding="utf-8") as f:
        f.write("iTrader.im Brand Usage Guidelines\n")
        f.write("=" * 40 + "\n\n")
        f.write("1. Always use official logo files from this package.\n")
        f.write("2. Maintain minimum clear space around the logo.\n")
        f.write("3. Do not alter colors, proportions, or effects.\n")
        f.write("4. Use dark variants on dark backgrounds, light variants on light backgrounds.\n")
        f.write("5. The vortex icon may be used standalone at sizes >= 32px.\n")
        f.write(f"6. Primary brand colors: Red {C['neonRed']['hex']}, Blue {C['electricBlue']['hex']}, Gold {C['premiumGold']['hex']}\n")
        f.write("7. For questions, contact the brand team.\n")
    generated_files.append(str(legal_path.relative_to(base)))
    print("  Created brand-usage-guidelines.txt")
    
    # -----------------------------------------------------------------------
    # ZIP PACKAGE
    # -----------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("Packaging ZIP...")
    
    zip_path = ROOT / "itrader-brand-assets-v2.zip"
    with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
        for root_dir, dirs, files in os.walk(str(base)):
            for file in files:
                file_path = os.path.join(root_dir, file)
                arcname = os.path.relpath(file_path, str(base))
                zf.write(file_path, arcname)
    
    # Validation
    print("\n" + "=" * 60)
    print("VALIDATION")
    print("=" * 60)
    
    total = len(generated_files)
    missing = []
    for f_rel in generated_files:
        full = base / f_rel
        if not full.exists():
            missing.append(f_rel)
    
    print(f"Total assets generated: {total}")
    print(f"Missing files: {len(missing)}")
    if missing:
        for m in missing:
            print(f"  MISSING: {m}")
    
    with zipfile.ZipFile(str(zip_path), "r") as zf:
        zip_count = len(zf.namelist())
    
    zip_size_mb = os.path.getsize(str(zip_path)) / (1024 * 1024)
    print(f"ZIP contains: {zip_count} files")
    print(f"ZIP size: {zip_size_mb:.2f} MB")
    print(f"ZIP location: {zip_path}")
    
    print("\n" + "=" * 60)
    print("ASSET GENERATION COMPLETE")
    print("=" * 60)
    
    return str(zip_path)


if __name__ == "__main__":
    main()
