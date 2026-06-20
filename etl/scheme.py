"""Coding scheme — field-source resolver + projektová SNIM definícia (D-033).

`object_ref` (D-010 vrstva 2) sa **skladá z kódovacej schémy projektu**, nie z IFC
`Tag` (Revit interné číslo, napr. `959314` — nestabilné, nepoužiteľné na párovanie
s výkresmi). Schéma je sada usporiadaných **typovaných polí + delimiterov**; každé
pole má **deskriptor zdroja** (`from`), voliteľný `extract` (regex) a `format` (pad/
case/trim). Tá istá definícia poháňa extrakciu (ETL: odkiaľ čítať) aj — neskôr —
validáciu (IDS). Žiadny nový klasifikačný/kódovací systém nevyžaduje zmenu kódu, len
inú definíciu schémy → **mimo tohto súboru sa nič SNIM-špecifické nehardcoduje**.

Zistené z reálneho IFC diplomky (`Office centrum Brno - ASR.ifc`) a `SNIM - Hierarchia.pdf`:
  • SNIM kód má 6 pozícií: TSP·PSP | (delim) | UOT | (delim) | INST.
  • Zdroj polí je custom pset (dvere `IFC_Dvere`, steny `IFC_Steny`, …) s property
    `Assembly Code` (= TSP+PSP, napr. `DD01`), `Type Mark` (UOT) a `Mark` (INST).
  • **Kategóriu (TSP) určuje prefix `Assembly Code`, NIE IFC trieda ani názov psetu** —
    napr. fasáda `FS*` aj strecha `ST*` sa v modeli vyskytujú v psete `IFC_Steny` na
    `IfcWall`. Preto polia čítame **naprieč všetkými psetmi** (názov property je
    diskriminátor) a kategóriu rozlišujeme podľa TSP.
  • **Typové entity (`IfcDoorType`…) nemajú vlastné psety** — type-level kód sa odvodí
    z type-úrovňových polí na occurrence (rieši `transform.py`).

Skladba kódu (overené dvere): `Assembly Code=DD01`, `Type Mark=6→06`, `Mark=3→03`
⇒ type `DD01.06`, inštancia `DD01.06.03`. Číselné polia sa zero-padujú.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

# Úrovne kódu — type-level pole tvorí `asset_type` ref, instance-level dopĺňa `asset`.
TYPE = "type"
INSTANCE = "instance"


# ── Field-source resolver (projektovo-nezávislý) ──────────────────────────────


@dataclass(frozen=True)
class Field:
    """Deskriptor jedného poľa kódu — odkiaľ a ako prečítať jeho hodnotu (D-033).

    `source`:
      • ``property``       — pomenovaný pset (`pset=`) alebo naprieč všetkými (`pset=None`)
      • ``attribute``      — IFC atribút (`Name`/`Tag`/`ObjectType`/`Description`/…)
      • ``classification`` — identifikátor referencie systému `key` (system+identification)
      • ``type_property``  — property z `IfcTypeObject` (pset na type)
    `extract` — regex s jednou capture skupinou (kód zapečený v texte, napr. `…CC:DD02.05`).
    `pad`     — **minimálna** šírka zero-paddingu číselného poľa (nikdy neoreže dlhšiu hodnotu).
    """

    source: str
    key: str
    pset: Optional[str] = None
    extract: Optional[str] = None
    pad: Optional[int] = None
    case: Optional[str] = None          # "upper" | "lower" | None
    trim: bool = True


@dataclass
class FieldContext:
    """Predčítané dáta jednej entity — drží resolver čistý a testovateľný.

    `transform.py` ho naplní cez ifcopenshell; resolver tu nezávisí od ifcopenshell.
    """

    psets: dict[str, dict[str, Any]] = field(default_factory=dict)        # occurrence (+inherited)
    type_psets: dict[str, dict[str, Any]] = field(default_factory=dict)   # IfcTypeObject psets
    attrs: Callable[[str], Any] = lambda _name: None                      # IFC atribút
    classifications: list[tuple[str, str]] = field(default_factory=list)  # (system, identification)


def _scan_psets(psets: dict[str, dict[str, Any]], pset: Optional[str], key: str) -> Any:
    """Hodnota property `key`: z pomenovaného psetu, inak naprieč všetkými (prvá zhoda)."""
    if pset is not None:
        block = psets.get(pset)
        if isinstance(block, dict) and block.get(key) not in (None, ""):
            return block.get(key)
        # named pset chýba/nemá pole → fallback na sken všetkých (robustné voči anomáliám)
    for block in psets.values():
        if isinstance(block, dict) and block.get(key) not in (None, ""):
            return block.get(key)
    return None


def _raw_value(spec: Field, ctx: FieldContext) -> Any:
    if spec.source == "property":
        return _scan_psets(ctx.psets, spec.pset, spec.key)
    if spec.source == "type_property":
        return _scan_psets(ctx.type_psets, spec.pset, spec.key)
    if spec.source == "attribute":
        return ctx.attrs(spec.key)
    if spec.source == "classification":
        for system, identification in ctx.classifications:
            if system == spec.key:
                return identification
        return None
    raise ValueError(f"Neznámy field source: {spec.source!r}")


def resolve_field(spec: Field, ctx: FieldContext) -> Optional[str]:
    """Vráti naformátovanú textovú hodnotu poľa, alebo None ak chýba."""
    raw = _raw_value(spec, ctx)
    if raw is None:
        return None
    text = str(raw)
    if spec.trim:
        text = text.strip()
    if not text:
        return None
    if spec.extract:
        match = re.search(spec.extract, text)
        if not match:
            return None
        text = match.group(1) if match.groups() else match.group(0)
    if spec.pad and text.isdigit():
        text = text.zfill(spec.pad)        # minimálna šírka — dlhšie hodnoty ostávajú
    if spec.case == "upper":
        text = text.upper()
    elif spec.case == "lower":
        text = text.lower()
    return text or None


# ── Zložený kód (object_ref) ──────────────────────────────────────────────────


@dataclass(frozen=True)
class CodePart:
    """Jedna pozícia zloženého `object_ref`. `level=INSTANCE` patrí len do asset refu."""

    field: Field
    level: str = TYPE


@dataclass
class ElementScheme:
    """Definícia jednej kategórie kódovacej schémy (napr. SNIM „Dvere")."""

    tsp: str                          # kľúč kategórie = prefix Assembly Code (napr. "DD")
    label: str                        # ľudský názov ("Dvere")
    applies_to: tuple[str, ...]       # IFC triedy, kde sa kód očakáva (mini-IDS applicability)
    parts: tuple[CodePart, ...]
    delimiter: str = "."

    def _join(self, ctx: FieldContext, max_level: str) -> tuple[Optional[str], list[str]]:
        """Poskladá kód po `max_level`. Vráti (kód|None, chýbajúce_polia).

        Type-level pole je povinné (bez neho niet kódu). Instance-level pole, ktoré
        chýba pri `max_level=INSTANCE`, znamená „kód neúplný" → None + dôvod.
        """
        out: list[str] = []
        missing: list[str] = []
        for part in self.parts:
            if part.level == INSTANCE and max_level != INSTANCE:
                continue
            value = resolve_field(part.field, ctx)
            if value is None:
                missing.append(part.field.key)
                if part.level == INSTANCE:
                    return None, missing      # chýbajúci INST = neúplný inštančný kód
                continue                      # voliteľné type pole (napr. chýbajúci UOT)
            out.append(value)
        if not out:
            return None, missing
        return self.delimiter.join(out), missing


@dataclass(frozen=True)
class ScopePolicy:
    """Rozsah importu (D-034) — ktoré IFC elementy sa stávajú `asset`.

    Princíp D-034: *„asset = to, na čo máme vypísanú informačnú požiadavku."*
    Štruktúrne kritérium (IFC-natívne, nezávislé od kvality kódovania):
      • asset = **top-level** prvok (visí priamo v priestore: `get_aggregate` =
        priestor/None) — reálne spravovateľné celky (steny, dvere, strechy, dosky,
        VZT terminály, stĺpy, podhľady, fasáda ako celok, schody, nábytok);
      • vyhodené sú **voidy** (`IfcFeatureElement` = otvory) a **sub-komponenty**
        (vnorené prvky — stĺpiky/výplne/panely fasády, vrstvy strechy, ramená schodov);
      • **výnimka:** vnorené `IfcDoor`/`IfcWindow` (osadené vo fasáde) ostávajú asset
        — funkčne sú samostatné prvky napriek vnoreniu.

    Definované ako **policy (config), nie hardcode v `transform.py`** — iný projekt
    = iná policy (línia D-033/D-034). Resolver nezávisí od ifcopenshell: dostáva
    `is_a` callable (IFC inheritance check) + príznak `top_level`.
    """

    exclude_classes: tuple[str, ...] = ("IfcFeatureElement",)   # otvory/voidy — nikdy asset
    nested_keep: tuple[str, ...] = ("IfcDoor", "IfcWindow")     # funkčné prvky aj vnorené

    def is_asset(self, is_a: Callable[[str], bool], top_level: bool) -> bool:
        if any(is_a(cls) for cls in self.exclude_classes):
            return False
        if top_level:
            return True
        return any(is_a(cls) for cls in self.nested_keep)


@dataclass
class CodingScheme:
    """Projektová schéma: ako rozpoznať kategóriu a poskladať `object_ref`."""

    name: str
    discriminator: Field              # číta surový kód identifikujúci kategóriu (Assembly Code)
    discriminator_len: int            # koľko znakov tvorí TSP kľúč (SNIM = 2)
    categories: dict[str, ElementScheme]
    scope: ScopePolicy = field(default_factory=ScopePolicy)   # rozsah importu (D-034)

    def applicable_classes(self) -> set[str]:
        """Zjednotenie `applies_to` — IFC triedy, kde sa kód SNIM vôbec očakáva."""
        classes: set[str] = set()
        for cat in self.categories.values():
            classes.update(cat.applies_to)
        return classes

    def category_for(self, ctx: FieldContext) -> tuple[Optional[ElementScheme], Optional[str]]:
        """Nájde kategóriu podľa TSP prefixu. Vráti (kategória|None, tsp|None)."""
        raw = resolve_field(self.discriminator, ctx)
        if not raw:
            return None, None
        tsp = raw[: self.discriminator_len]
        return self.categories.get(tsp), tsp


# ── SNIM definícia projektu „Office centrum Brno" ─────────────────────────────
#
# Všetky SNIM kategórie zdieľajú rovnakú skladbu (Assembly Code [type] + Type Mark
# [type, UOT] + Mark [instance, INST]); líšia sa TSP, ľudským názvom a `applies_to`.
# Polia čítame naprieč psetmi (názov property je diskriminátor), preto `pset=None`.
#
# Padding (D-033 otvorená otázka — INST šírka per výkres): UOT aj INST = min. šírka 2
# (overené na dverách `DD01.06.03`; `pad` neoreže dlhšie hodnoty). Per pole upraviteľné.

_ASSEMBLY_CODE = Field(source="property", key="Assembly Code")   # TSP+PSP, napr. "DD01"
_UOT_PAD = 2
_INST_PAD = 2


def _snim_parts() -> tuple[CodePart, ...]:
    return (
        CodePart(_ASSEMBLY_CODE, level=TYPE),
        CodePart(Field(source="property", key="Type Mark", pad=_UOT_PAD), level=TYPE),
        CodePart(Field(source="property", key="Mark", pad=_INST_PAD), level=INSTANCE),
    )


def _snim_category(tsp: str, label: str, applies_to: tuple[str, ...]) -> ElementScheme:
    return ElementScheme(tsp=tsp, label=label, applies_to=applies_to, parts=_snim_parts())


# `applies_to` = IFC triedy, na ktorých sa daný TSP v modeli reálne vyskytuje
# (overené skenom ASR IFC) + zmysluplné podľa `SNIM - Hierarchia.pdf` /
# `SNIM - Výpis skladieb.pdf`. Slúži ako mini-IDS applicability pre coverage report;
# samotná tvorba kódu beží podľa TSP prefixu (naprieč psetmi), nezávisle od triedy.
#
# Kategórie z `SNIM - Hierarchia.pdf` (8): DD, SN, FS, PH, ST, PD, ZV, KV.
# Doplnené z `SNIM - Výpis skladieb.pdf` + skenu ASR (E2): OV, PL, ZD, DZ, SD, VT,
# SH, LP, IH, TV. Label je diagnostický (coverage report); object.name vo Vieweri
# ide z IFC Name, nie odtiaľto. Skladba kódu je rovnaká pre všetky (Assembly Code
# [type] + Type Mark [type/UOT] + Mark [instance/INST]); väčšina kategórií nemá
# `Mark` → inštancia ide na GUID fallback (správne — netlačí sa inštančný tag).
SNIM = CodingScheme(
    name="SNIM — Office centrum Brno (diplomka)",
    discriminator=_ASSEMBLY_CODE,
    discriminator_len=2,
    categories={
        # — z Hierarchia.pdf —
        "DD": _snim_category("DD", "Dvere", ("IfcDoor",)),
        "SN": _snim_category("SN", "Steny", ("IfcWall",)),
        "PD": _snim_category("PD", "Podlahy", ("IfcSlab",)),
        "PH": _snim_category("PH", "Podhľady", ("IfcCovering",)),
        "ST": _snim_category("ST", "Strechy", ("IfcRoof", "IfcSlab", "IfcWall")),
        "FS": _snim_category(
            "FS", "Fasádny systém",
            ("IfcWall", "IfcSlab", "IfcCurtainWall", "IfcMember", "IfcPlate"),
        ),
        "ZV": _snim_category(
            "ZV", "Zámočnícke výrobky",
            ("IfcRailing", "IfcStair", "IfcStairFlight", "IfcBuildingElementProxy"),
        ),
        "KV": _snim_category(
            "KV", "Klampiarske výrobky",
            ("IfcPlate", "IfcCovering", "IfcBuildingElementProxy"),
        ),
        # — doplnené v E2 (Výpis skladieb + sken ASR) —
        "OV": _snim_category(
            "OV", "Otvorové výplne a vybavenie",
            ("IfcFlowTerminal", "IfcFurniture", "IfcCurtainWall"),
        ),
        "PL": _snim_category("PL", "Presklené steny/priečky", ("IfcCurtainWall",)),
        "LP": _snim_category("LP", "Ľahký obvodový plášť (LOP)", ("IfcCurtainWall",)),
        "ZD": _snim_category("ZD", "Základové dosky", ("IfcSlab", "IfcWall")),
        "DZ": _snim_category("DZ", "Podkladný betón", ("IfcSlab", "IfcWall")),
        "SD": _snim_category("SD", "Stropné dosky", ("IfcSlab",)),
        "IH": _snim_category("IH", "Hydroizolácie spodnej stavby", ("IfcWall", "IfcSlab")),
        "VT": _snim_category("VT", "Vráta", ("IfcDoor",)),
        "SH": _snim_category("SH", "Schodiská", ("IfcStair", "IfcStairFlight", "IfcSlab")),
        "TV": _snim_category("TV", "Tieniaca technika", ("IfcRailing", "IfcBuildingElementProxy")),
    },
)
"""Aktívna schéma projektu. Iný projekt = iná `CodingScheme` (kód sa nemení)."""
