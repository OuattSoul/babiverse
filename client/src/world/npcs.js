// Registre des PNJ : identité, apparence et dialogues. Le placement est dans zones.js.
// `services` liste les fonctions proposées dans le dialogue (boutique, emploi...).

export const NPCS = {
  koffi: {
    name: 'Tonton Koffi',
    role: 'Doyen du quartier',
    look: { skin: '#8d5524', outfit: '#7f8c8d', hair: 'bald', pants: '#3b3b3b' },
    lines: [
      'Akwaba mon fils ! Ici à la Cité, tout le monde se connaît.',
      "Si tu cherches du travail, va voir M. Diabaté au dépôt, au bout de la rue.",
      "L'emplacement près de la route est libre. Avec un peu d'argent, tu pourrais y monter un kiosque.",
    ],
    services: ['missions'],
  },
  aya: {
    name: 'Aya',
    role: 'Étudiante en BTS',
    look: { skin: '#c68642', outfit: '#e84393', hair: 'braids', pants: '#2d3436' },
    lines: [
      "Je révise sous le manguier, il fait moins chaud qu'à la maison.",
      "Le garba de Tantie Adjoua, c'est le meilleur du quartier. Et pas cher !",
    ],
    services: [],
  },
  fofana: {
    name: 'M. Fofana',
    role: 'Épicier',
    look: { skin: '#5c3a1e', outfit: '#16a085', hair: 'short', pants: '#2c3e50' },
    lines: ['Bonjour ! Qu\'est-ce qu\'il te faut aujourd\'hui ?'],
    services: ['shop:epicerie'],
  },
  adjoua: {
    name: 'Tantie Adjoua',
    role: 'Vendeuse de garba',
    look: { skin: '#8d5524', outfit: '#d35400', hair: 'braids', pants: '#d35400' },
    lines: ['Garba chaud, alloco bien doré ! Viens manger, mon enfant.'],
    services: ['shop:garba'],
  },
  diabate: {
    name: 'M. Diabaté',
    role: 'Grossiste',
    look: { skin: '#5c3a1e', outfit: '#2980b9', hair: 'short', pants: '#34495e' },
    lines: ["J'ai toujours des colis à livrer dans le quartier. Tu es payé à la fin du service."],
    services: ['job:livraison', 'missions'],
  },
  ibrahim: {
    name: 'Ibrahim',
    role: 'Chauffeur de taxi',
    look: { skin: '#5c3a1e', outfit: '#f39c12', hair: 'short', pants: '#2c3e50' },
    lines: [
      'Je fais une pause au maquis, le goudron chauffe trop à midi.',
      "Plateau, Adjamé, Treichville… je connais toutes les routes d'Abidjan.",
    ],
    services: [],
  },
  seydou: {
    name: 'Seydou',
    role: 'Apprenti gbaka',
    look: { skin: '#8d5524', outfit: '#2980b9', hair: 'bald', pants: '#7f8c8d' },
    lines: [
      'Adjamé ! Adjamé ! Deux places derrière, on part maintenant !',
      "Le gbaka ne s'arrête pas longtemps : faut monter vite, mon frère.",
    ],
    services: [],
  },
  fatou: {
    name: 'Fatou',
    role: "Vendeuse d'eau",
    look: { skin: '#6b4423', outfit: '#e74c3c', hair: 'braids', pants: '#e74c3c' },
    lines: ['Eau fraîche, eau glacée ! Sachet à 50 francs, ça soulage.'],
    services: [],
  },
  awa: {
    name: 'Awa',
    role: 'Couturière',
    look: { skin: '#c68642', outfit: '#8e44ad', hair: 'braids', pants: '#f1c40f' },
    lines: [
      "Je couds les pagnes pour la fête du quartier. Repasse samedi !",
      'Un bon boubou, ça se mesure deux fois et ça se coupe une fois.',
    ],
    services: [],
  },
  kouassi: {
    name: 'Papa Kouassi',
    role: 'Mécanicien à la retraite',
    look: { skin: '#5c3a1e', outfit: '#7f8c8d', hair: 'short', pants: '#34495e' },
    lines: ["De mon temps, il n'y avait pas autant de voitures sur l'avenue. Fais attention en traversant !"],
    services: [],
  },
  bamba: {
    name: 'Mme Bamba',
    role: 'Commerçante',
    look: { skin: '#8d5524', outfit: '#16a085', hair: 'afro', pants: '#16a085' },
    lines: ['Bonjour mon enfant. Le quartier grandit vite, il y aura bientôt de nouvelles boutiques sur les parcelles.'],
    services: [],
  },
};
