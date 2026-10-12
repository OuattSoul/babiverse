"""Registre des comportements déclaratifs.

Un comportement est une capacité du MOTEUR (code) ; l'administration ne fait que l'associer à un asset
et en régler les paramètres autorisés. Aucun code fourni par l'interface n'est jamais exécuté.

`engine` indique la prise en charge réelle :
- "game"    : le jeu Babiverse actuel sait l'exploiter (via l'export d'intégration, cf. docs/INTEGRATION.md) ;
- "preview" : visible et vérifié dans l'atelier, pas encore exploité par le jeu (extension moteur à écrire).
Ajouter une nouvelle mécanique = ajouter une entrée ici ET l'implémenter côté jeu ; ensuite son
activation sur de nouveaux assets se fait depuis l'interface.
"""
from __future__ import annotations

from typing import Any

# Paramètres : type ∈ int | float | bool | str | choice ; bornes et valeurs par défaut
BEHAVIORS: dict[str, dict] = {
    "enter_interior": {
        "label": "Ouvrir un intérieur", "families": ["building"], "engine": "game",
        "description": "Toucher le bâtiment ouvre son intérieur associé (le premier dont le niveau est atteint).",
        "params": {},
        "requires": "Au moins un intérieur associé.",
    },
    "assignable_home": {
        "label": "Logement attribuable à un joueur", "families": ["building"], "engine": "game",
        "description": "Le bâtiment peut être attribué comme maison d'un joueur (lotissement).",
        "params": {},
    },
    "shop": {
        "label": "Vente de marchandises", "families": ["building", "furniture"], "engine": "game",
        "description": "Expose des emplacements de marchandises achetables.",
        "params": {"goods_slots": {"type": "int", "min": 1, "max": 200, "default": 12, "label": "Emplacements de marchandises"}},
    },
    "info_sheet": {
        "label": "Fiche d'information", "families": ["building", "prop", "vehicle", "character", "furniture"], "engine": "game",
        "description": "Toucher l'objet affiche une fiche avec ce texte.",
        "params": {"text": {"type": "str", "max": 200, "default": "", "label": "Texte de la fiche"}},
    },
    "interaction_zone": {
        "label": "Zone d'interaction", "families": ["building", "prop"], "engine": "preview",
        "description": "Rend active une zone déclarée de l'asset (vitrine, guichet…).",
        "params": {"zone_id": {"type": "str", "max": 48, "default": "", "label": "Identifiant de la zone"}},
        "requires": "Une zone de type « interaction » portant cet identifiant.",
    },
    "sleep": {"label": "Dormir", "families": ["furniture"], "engine": "game",
              "description": "Sieste : recharge l'énergie (règles du serveur de jeu).", "params": {}},
    "sit": {"label": "S'asseoir", "families": ["furniture", "prop"], "engine": "preview",
            "description": "Le personnage s'assoit.", "params": {}},
    "eat": {"label": "Manger", "families": ["furniture"], "engine": "preview", "description": "Table de repas.", "params": {}},
    "cook": {"label": "Cuisiner", "families": ["furniture"], "engine": "preview", "description": "Plan de cuisson.", "params": {}},
    "work": {"label": "Travailler", "families": ["furniture"], "engine": "preview", "description": "Poste de travail.", "params": {}},
    "store": {"label": "Ranger", "families": ["furniture"], "engine": "preview", "description": "Rangement.", "params": {}},
    "wash": {"label": "Se laver", "families": ["furniture"], "engine": "preview", "description": "Douche, lavabo.", "params": {}},
    "use": {"label": "Utiliser", "families": ["furniture"], "engine": "preview", "description": "Sanitaires.", "params": {}},
    "watch": {"label": "Regarder", "families": ["furniture"], "engine": "preview", "description": "Télévision.", "params": {}},
    "light_at_night": {
        "label": "Allumé la nuit", "families": ["prop"], "engine": "preview",
        "description": "L'objet s'éclaire entre le soir et le matin (le jeu le fait pour ses propres lampadaires).",
        "params": {"radius": {"type": "int", "min": 1, "max": 6, "default": 2, "label": "Rayon (cases)"}},
    },
    "npc_wander": {
        "label": "Flâner (PNJ)", "families": ["character"], "engine": "preview",
        "description": "Le personnage se promène autour de son point de départ (le jeu a ce mode pour ses PNJ codés).",
        "params": {"radius": {"type": "int", "min": 1, "max": 12, "default": 3, "label": "Rayon (cases)"}},
    },
    "npc_dialogue": {
        "label": "Dialogue simple", "families": ["character"], "engine": "preview",
        "description": "Phrase dite quand le joueur parle au personnage.",
        "params": {"greeting": {"type": "str", "max": 160, "default": "Akwaba !", "label": "Phrase d'accueil"}},
    },
    "parked": {"label": "Stationné", "families": ["vehicle"], "engine": "preview",
               "description": "Véhicule immobile, décor de rue.", "params": {}},
}

# Action d'un meuble (champ `action` des intérieurs) → comportement
FURNITURE_ACTIONS = ["sleep", "sit", "eat", "cook", "work", "store", "wash", "use", "watch", "shop"]


def check_params(behavior_id: str, params: dict[str, Any]) -> list[str]:
    """Retourne la liste des erreurs de paramètres (vide si valides)."""
    spec = BEHAVIORS[behavior_id]["params"]
    errors = []
    for k in params:
        if k not in spec:
            errors.append(f"paramètre inconnu « {k} »")
    for k, p in spec.items():
        if k not in params:
            continue
        v = params[k]
        t = p["type"]
        if t == "int" and (not isinstance(v, int) or isinstance(v, bool)):
            errors.append(f"« {p['label']} » doit être un entier")
        elif t == "float" and (not isinstance(v, (int, float)) or isinstance(v, bool)):
            errors.append(f"« {p['label']} » doit être un nombre")
        elif t == "bool" and not isinstance(v, bool):
            errors.append(f"« {p['label']} » doit être vrai ou faux")
        elif t == "str" and not isinstance(v, str):
            errors.append(f"« {p['label']} » doit être un texte")
        elif t == "choice" and v not in p["options"]:
            errors.append(f"« {p['label']} » : valeur non autorisée")
        else:
            if t in ("int", "float") and (v < p.get("min", v) or v > p.get("max", v)):
                errors.append(f"« {p['label']} » doit être entre {p['min']} et {p['max']}")
            if t == "str" and len(v) > p.get("max", 10_000):
                errors.append(f"« {p['label']} » : {p['max']} caractères maximum")
    return errors


def defaults(behavior_id: str) -> dict:
    return {k: p["default"] for k, p in BEHAVIORS[behavior_id]["params"].items()}
