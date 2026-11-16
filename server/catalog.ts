// Seed catalogue of Cambridge subjects and syllabus topics. Admins can add more
// from the dashboard; the AI classifier must pick from a subject's topic list.
import { db } from "./db";

type Seed = { code: string; name: string; level: "O" | "A"; icon: string; topics: string[] };

const PHYS_A = ["Physical quantities and units", "Kinematics", "Dynamics", "Forces, density and pressure", "Work, energy and power", "Deformation of solids", "Waves", "Superposition", "Electricity", "D.C. circuits", "Particle physics", "Motion in a circle", "Gravitational fields", "Temperature and thermal properties", "Ideal gases", "Thermodynamics", "Oscillations", "Electric fields", "Capacitance", "Magnetic fields", "Alternating currents", "Quantum physics", "Nuclear physics", "Medical physics", "Astronomy and cosmology"];
const CHEM_A = ["Atomic structure", "Atoms, molecules and stoichiometry", "Chemical bonding", "States of matter", "Chemical energetics", "Electrochemistry", "Equilibria", "Reaction kinetics", "The Periodic Table: chemical periodicity", "Group 2", "Group 17", "Nitrogen and sulfur", "Transition elements", "Introduction to organic chemistry", "Hydrocarbons", "Halogen compounds", "Hydroxy compounds", "Carbonyl compounds", "Carboxylic acids and derivatives", "Nitrogen compounds", "Polymerisation", "Organic synthesis", "Analytical techniques"];
const BIO_A = ["Cell structure", "Biological molecules", "Enzymes", "Cell membranes and transport", "The mitotic cell cycle", "Nucleic acids and protein synthesis", "Transport in plants", "Transport in mammals", "Gas exchange", "Infectious diseases", "Immunity", "Energy and respiration", "Photosynthesis", "Homeostasis", "Control and coordination", "Inheritance", "Selection and evolution", "Classification, biodiversity and conservation", "Genetic technology"];
const MATH_A = ["Quadratics", "Functions", "Coordinate geometry", "Circular measure", "Trigonometry", "Series", "Differentiation", "Integration", "Algebra", "Logarithmic and exponential functions", "Numerical solution of equations", "Vectors", "Differential equations", "Complex numbers", "Forces and equilibrium", "Kinematics of motion in a straight line", "Momentum", "Newton's laws of motion", "Energy, work and power", "Representation of data", "Permutations and combinations", "Probability", "Discrete random variables", "The normal distribution", "The Poisson distribution", "Linear combinations of random variables", "Continuous random variables", "Sampling and estimation", "Hypothesis tests"];
const ECON = ["Basic economic ideas and resource allocation", "The price system and the microeconomy", "Government microeconomic intervention", "The macroeconomy", "Government macroeconomic intervention", "International economic issues"];

const SEEDS: Seed[] = [
  { code: "9702", name: "Physics", level: "A", icon: "⚛️", topics: PHYS_A },
  { code: "9701", name: "Chemistry", level: "A", icon: "🧪", topics: CHEM_A },
  { code: "9700", name: "Biology", level: "A", icon: "🧬", topics: BIO_A },
  { code: "9709", name: "Mathematics", level: "A", icon: "📐", topics: MATH_A },
  { code: "9708", name: "Economics", level: "A", icon: "📈", topics: ECON },
  { code: "9618", name: "Computer Science", level: "A", icon: "💻", topics: ["Information representation", "Communication", "Hardware", "Processor fundamentals", "System software", "Security, privacy and data integrity", "Ethics and ownership", "Databases", "Algorithm design and problem-solving", "Data types and structures", "Programming", "Software development", "Data representation", "Communication and internet technologies", "Hardware and virtual machines", "Artificial intelligence", "Computational thinking and problem-solving", "Further programming"] },
  { code: "9706", name: "Accounting", level: "A", icon: "🧾", topics: ["Financial accounting", "Cost and management accounting", "Preparation of financial statements", "Analysis and communication of accounting information", "Budgeting", "Investment appraisal"] },
  { code: "9609", name: "Business", level: "A", icon: "💼", topics: ["Business and its environment", "Human resource management", "Marketing", "Operations management", "Finance and accounting", "Business strategy"] },
  { code: "5054", name: "Physics", level: "O", icon: "⚛️", topics: ["Measurement and units", "Motion", "Forces and momentum", "Mass, weight and density", "Pressure", "Energy, work and power", "Kinetic particle model of matter", "Thermal properties and temperature", "Transfer of thermal energy", "General properties of waves", "Light", "Electromagnetic spectrum", "Sound", "Magnetism", "Electrical quantities", "Electric circuits", "Practical electricity and safety", "Electromagnetic effects", "The nuclear model of the atom", "Radioactivity", "Space physics"] },
  { code: "5070", name: "Chemistry", level: "O", icon: "🧪", topics: ["States of matter", "Atoms, elements and compounds", "Stoichiometry", "Electrochemistry", "Chemical energetics", "Chemical reactions", "Acids, bases and salts", "The Periodic Table", "Metals", "Chemistry of the environment", "Organic chemistry", "Experimental techniques and chemical analysis"] },
  { code: "5090", name: "Biology", level: "O", icon: "🧬", topics: ["Cells", "Classification", "Movement into and out of cells", "Biological molecules", "Enzymes", "Plant nutrition", "Transport in flowering plants", "Human nutrition", "Human gas exchange", "Respiration", "Transport in humans", "Disease and immunity", "Excretion", "Coordination and control", "Coordination and response in plants", "Development of organisms and continuity of life", "Inheritance", "Biotechnology and genetic modification", "Relationships of organisms with one another and with the environment"] },
  { code: "4024", name: "Mathematics (Syllabus D)", level: "O", icon: "📐", topics: ["Number", "Algebra and graphs", "Coordinate geometry", "Geometry", "Mensuration", "Trigonometry", "Transformations and vectors", "Probability", "Statistics"] },
  { code: "4037", name: "Additional Mathematics", level: "O", icon: "➗", topics: ["Functions", "Quadratic functions", "Factors of polynomials", "Equations, inequalities and graphs", "Simultaneous equations", "Logarithmic and exponential functions", "Straight-line graphs", "Coordinate geometry of the circle", "Circular measure", "Trigonometry", "Permutations and combinations", "Series", "Vectors in two dimensions", "Calculus"] },
  { code: "2281", name: "Economics", level: "O", icon: "📈", topics: ["The basic economic problem", "The allocation of resources", "Microeconomic decision-makers", "Government and the macroeconomy", "Economic development", "International trade and globalisation"] },
  { code: "2210", name: "Computer Science", level: "O", icon: "💻", topics: ["Data representation", "Data transmission", "Hardware", "Software", "The internet and its uses", "Automated and emerging technologies", "Algorithm design and problem-solving", "Programming", "Databases", "Boolean logic"] },
  { code: "7707", name: "Accounting", level: "O", icon: "🧾", topics: ["The fundamentals of accounting", "Sources and recording of data", "Verification of accounting records", "Accounting procedures", "Preparation of financial statements", "Analysis and interpretation", "Accounting principles and policies"] },
  { code: "2059", name: "Pakistan Studies", level: "O", icon: "🕌", topics: ["Cultural and historical background to the Pakistan Movement", "The emergence of Pakistan 1906–1947", "Nationhood 1947–1999", "The land of Pakistan", "Natural resources", "Power", "Agricultural development", "Industrial development", "Trade", "Transport and communications", "Population and employment"] },
];

export function seedCatalog() {
  const insS = db.prepare("INSERT OR IGNORE INTO subjects(code,name,level,icon) VALUES(?,?,?,?)");
  const insT = db.prepare("INSERT OR IGNORE INTO topics(subject_code,name,position) VALUES(?,?,?)");
  db.transaction(() => {
    for (const s of SEEDS) {
      insS.run(s.code, s.name, s.level, s.icon);
      s.topics.forEach((t, i) => insT.run(s.code, t, i));
    }
  })();
}

export function topicsFor(code: string): string[] {
  return (db.prepare("SELECT name FROM topics WHERE subject_code=? ORDER BY position,id").all(code) as any[]).map((r) => r.name);
}
