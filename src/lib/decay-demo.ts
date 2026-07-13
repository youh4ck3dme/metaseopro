// Realistic demo datasets for the Decay Radar. Used only in Demo Mode.
// Every consumer must clearly mark this data as demo — never mix with live GSC data.
import type { DecayRow, DecayScenario } from "./decay-schema";

type DemoScenario = {
  siteUrl: string;
  rows: DecayRow[];
};

export const DEMO_PERIOD_PREV = "Predchádzajúcich 90 dní";
export const DEMO_PERIOD_NOW = "Posledných 90 dní";

export const DEMO_SCENARIOS: Record<DecayScenario, DemoScenario> = {
  blog: {
    siteUrl: "https://demo-blog.sk",
    rows: [
      {
        url: "https://demo-blog.sk/ako-zacat-behat",
        title: "Ako začať behať: kompletný návod pre začiatočníkov",
        clicksPrev: 4200,
        clicksNow: 1850,
        impressionsPrev: 98000,
        impressionsNow: 71000,
        positionPrev: 3.1,
        positionNow: 7.8,
        topQueries: [
          { query: "ako začať behať", clicksPrev: 1900, clicksNow: 720, positionPrev: 2.4, positionNow: 6.9 },
          { query: "beh pre začiatočníkov", clicksPrev: 1100, clicksNow: 540, positionPrev: 3.0, positionNow: 8.1 },
          { query: "behanie plán", clicksPrev: 620, clicksNow: 310, positionPrev: 4.2, positionNow: 9.4 },
        ],
      },
      {
        url: "https://demo-blog.sk/najlepsie-recepty-ovsena-kasa",
        title: "Najlepšie recepty na ovsenú kašu",
        clicksPrev: 2600,
        clicksNow: 1520,
        impressionsPrev: 61000,
        impressionsNow: 49000,
        positionPrev: 4.0,
        positionNow: 6.2,
        topQueries: [
          { query: "ovsená kaša recept", clicksPrev: 1400, clicksNow: 820, positionPrev: 3.5, positionNow: 5.8 },
          { query: "raňajky ovsené vločky", clicksPrev: 700, clicksNow: 400, positionPrev: 4.6, positionNow: 7.0 },
        ],
      },
      {
        url: "https://demo-blog.sk/produktivita-rano",
        title: "Ranná rutina pre vyššiu produktivitu",
        clicksPrev: 1800,
        clicksNow: 1740,
        impressionsPrev: 40000,
        impressionsNow: 41000,
        positionPrev: 5.2,
        positionNow: 5.0,
        topQueries: [
          { query: "ranná rutina", clicksPrev: 900, clicksNow: 880, positionPrev: 4.8, positionNow: 4.7 },
        ],
      },
      {
        url: "https://demo-blog.sk/ako-setrit-peniaze",
        title: "Ako šetriť peniaze: 25 praktických tipov",
        clicksPrev: 3100,
        clicksNow: 900,
        impressionsPrev: 88000,
        impressionsNow: 52000,
        positionPrev: 2.8,
        positionNow: 11.3,
        topQueries: [
          { query: "ako šetriť peniaze", clicksPrev: 1600, clicksNow: 380, positionPrev: 2.2, positionNow: 10.6 },
          { query: "tipy na šetrenie", clicksPrev: 900, clicksNow: 300, positionPrev: 3.4, positionNow: 12.0 },
        ],
      },
      {
        url: "https://demo-blog.sk/domace-cvicenie",
        title: "Domáce cvičenie bez vybavenia",
        clicksPrev: 1400,
        clicksNow: 2100,
        impressionsPrev: 33000,
        impressionsNow: 45000,
        positionPrev: 6.9,
        positionNow: 4.4,
        topQueries: [
          { query: "cvičenie doma", clicksPrev: 800, clicksNow: 1200, positionPrev: 6.1, positionNow: 3.9 },
        ],
      },
    ],
  },
  ecommerce: {
    siteUrl: "https://demo-shop.sk",
    rows: [
      {
        url: "https://demo-shop.sk/kategoria/behecke-topanky",
        title: "Bežecké topánky — kategória",
        clicksPrev: 6800,
        clicksNow: 3100,
        impressionsPrev: 210000,
        impressionsNow: 165000,
        positionPrev: 2.6,
        positionNow: 6.4,
        topQueries: [
          { query: "bežecké topánky", clicksPrev: 3200, clicksNow: 1400, positionPrev: 2.1, positionNow: 5.9 },
          { query: "topánky na beh dámske", clicksPrev: 1600, clicksNow: 780, positionPrev: 3.0, positionNow: 6.8 },
        ],
      },
      {
        url: "https://demo-shop.sk/produkt/gore-tex-bunda",
        title: "GORE-TEX nepremokavá bunda",
        clicksPrev: 2400,
        clicksNow: 760,
        impressionsPrev: 72000,
        impressionsNow: 38000,
        positionPrev: 3.4,
        positionNow: 12.1,
        topQueries: [
          { query: "nepremokavá bunda", clicksPrev: 1200, clicksNow: 320, positionPrev: 2.9, positionNow: 11.4 },
          { query: "gore-tex bunda", clicksPrev: 700, clicksNow: 260, positionPrev: 3.8, positionNow: 12.9 },
        ],
      },
      {
        url: "https://demo-shop.sk/blog/ako-vybrat-batoh",
        title: "Ako vybrať turistický batoh (sprievodca)",
        clicksPrev: 1900,
        clicksNow: 1180,
        impressionsPrev: 54000,
        impressionsNow: 43000,
        positionPrev: 4.1,
        positionNow: 6.6,
        topQueries: [
          { query: "ako vybrať batoh", clicksPrev: 1000, clicksNow: 600, positionPrev: 3.7, positionNow: 6.2 },
        ],
      },
      {
        url: "https://demo-shop.sk/kategoria/stany",
        title: "Stany — kategória",
        clicksPrev: 3300,
        clicksNow: 3250,
        impressionsPrev: 96000,
        impressionsNow: 97000,
        positionPrev: 3.0,
        positionNow: 3.1,
        topQueries: [
          { query: "stan pre 2 osoby", clicksPrev: 1700, clicksNow: 1680, positionPrev: 2.7, positionNow: 2.8 },
        ],
      },
      {
        url: "https://demo-shop.sk/produkt/celovka-led",
        title: "LED čelovka 500 lm",
        clicksPrev: 900,
        clicksNow: 1600,
        impressionsPrev: 28000,
        impressionsNow: 41000,
        positionPrev: 7.2,
        positionNow: 4.1,
        topQueries: [
          { query: "čelovka led", clicksPrev: 500, clicksNow: 950, positionPrev: 6.5, positionNow: 3.7 },
        ],
      },
    ],
  },
  local: {
    siteUrl: "https://demo-kaviaren.sk",
    rows: [
      {
        url: "https://demo-kaviaren.sk/menu",
        title: "Menu a nápojový lístok",
        clicksPrev: 2100,
        clicksNow: 980,
        impressionsPrev: 44000,
        impressionsNow: 31000,
        positionPrev: 2.3,
        positionNow: 5.9,
        topQueries: [
          { query: "kaviareň bratislava menu", clicksPrev: 1100, clicksNow: 440, positionPrev: 1.9, positionNow: 5.4 },
          { query: "espresso bar centrum", clicksPrev: 500, clicksNow: 220, positionPrev: 2.8, positionNow: 6.6 },
        ],
      },
      {
        url: "https://demo-kaviaren.sk/raonajky",
        title: "Raňajky a brunch",
        clicksPrev: 1500,
        clicksNow: 520,
        impressionsPrev: 33000,
        impressionsNow: 19000,
        positionPrev: 3.0,
        positionNow: 10.4,
        topQueries: [
          { query: "raňajky bratislava", clicksPrev: 800, clicksNow: 240, positionPrev: 2.6, positionNow: 9.8 },
          { query: "brunch centrum", clicksPrev: 400, clicksNow: 160, positionPrev: 3.6, positionNow: 11.2 },
        ],
      },
      {
        url: "https://demo-kaviaren.sk/kontakt",
        title: "Kontakt a otváracie hodiny",
        clicksPrev: 1200,
        clicksNow: 1170,
        impressionsPrev: 21000,
        impressionsNow: 21500,
        positionPrev: 1.6,
        positionNow: 1.7,
        topQueries: [
          { query: "kaviareň otváracie hodiny", clicksPrev: 700, clicksNow: 690, positionPrev: 1.4, positionNow: 1.5 },
        ],
      },
      {
        url: "https://demo-kaviaren.sk/eventy",
        title: "Súkromné akcie a eventy",
        clicksPrev: 800,
        clicksNow: 300,
        impressionsPrev: 15000,
        impressionsNow: 8000,
        positionPrev: 4.2,
        positionNow: 13.5,
        topQueries: [
          { query: "priestor na oslavu bratislava", clicksPrev: 420, clicksNow: 140, positionPrev: 3.9, positionNow: 12.8 },
        ],
      },
      {
        url: "https://demo-kaviaren.sk/o-nas",
        title: "O nás — príbeh kaviarne",
        clicksPrev: 400,
        clicksNow: 620,
        impressionsPrev: 9000,
        impressionsNow: 12000,
        positionPrev: 6.0,
        positionNow: 4.2,
        topQueries: [
          { query: "najlepšia kaviareň bratislava", clicksPrev: 200, clicksNow: 360, positionPrev: 5.4, positionNow: 3.8 },
        ],
      },
    ],
  },
  saas: {
    siteUrl: "https://demo-saas.com",
    rows: [
      {
        url: "https://demo-saas.com/blog/project-management-tips",
        title: "12 Project Management Tips for Remote Teams",
        clicksPrev: 5400,
        clicksNow: 2100,
        impressionsPrev: 160000,
        impressionsNow: 118000,
        positionPrev: 2.9,
        positionNow: 7.4,
        topQueries: [
          { query: "project management tips", clicksPrev: 2600, clicksNow: 900, positionPrev: 2.3, positionNow: 6.8 },
          { query: "remote team management", clicksPrev: 1500, clicksNow: 640, positionPrev: 3.1, positionNow: 7.9 },
        ],
      },
      {
        url: "https://demo-saas.com/compare/vs-competitor",
        title: "Demo vs Competitor: Full Comparison",
        clicksPrev: 3200,
        clicksNow: 1050,
        impressionsPrev: 74000,
        impressionsNow: 46000,
        positionPrev: 3.2,
        positionNow: 9.6,
        topQueries: [
          { query: "best project tool alternative", clicksPrev: 1700, clicksNow: 500, positionPrev: 2.8, positionNow: 9.1 },
        ],
      },
      {
        url: "https://demo-saas.com/blog/okr-guide",
        title: "The Complete Guide to OKRs",
        clicksPrev: 2800,
        clicksNow: 1900,
        impressionsPrev: 82000,
        impressionsNow: 70000,
        positionPrev: 4.0,
        positionNow: 5.7,
        topQueries: [
          { query: "okr guide", clicksPrev: 1400, clicksNow: 980, positionPrev: 3.6, positionNow: 5.2 },
        ],
      },
      {
        url: "https://demo-saas.com/pricing",
        title: "Pricing",
        clicksPrev: 4100,
        clicksNow: 4050,
        impressionsPrev: 65000,
        impressionsNow: 66000,
        positionPrev: 1.8,
        positionNow: 1.9,
        topQueries: [
          { query: "demo saas pricing", clicksPrev: 2200, clicksNow: 2180, positionPrev: 1.5, positionNow: 1.6 },
        ],
      },
      {
        url: "https://demo-saas.com/blog/async-communication",
        title: "Async Communication Playbook",
        clicksPrev: 1200,
        clicksNow: 2400,
        impressionsPrev: 38000,
        impressionsNow: 61000,
        positionPrev: 8.1,
        positionNow: 4.0,
        topQueries: [
          { query: "async communication", clicksPrev: 700, clicksNow: 1400, positionPrev: 7.4, positionNow: 3.6 },
        ],
      },
    ],
  },
};
