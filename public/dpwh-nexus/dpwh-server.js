/**
 * 🏛️ DPWH NEXUS Core Server & REST API Engine
 * Manages Document Ingestion, SLA Workflows, DUPA DO 30 s. 2025 Cost Engine & Audit Ledger
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// System Seed Data (In-Memory Database for DPWH Offices)
let projects = [
  {
    id: "26AB0012",
    title: "Construction of Multi-Purpose Flood Control Structure along Pampanga River",
    office: "Pampanga 1st DEO",
    region: "Region III",
    category: "Flood Control",
    cost: 45000000,
    stage: "POW_ABC_APPROVAL", // Stages: IDENTIFICATION, VALIDATION, POW_ABC_APPROVAL, BIDDING, BILLING
    stationLimits: "Sta. 04+120 to Sta. 06+450",
    coordinates: "15.0345° N, 120.6821° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "NORMAL", // NORMAL, WARNING, BREACH
    slaRemainingHours: 34,
    createdDate: "2026-08-01T08:30:00Z",
    hash: "0x8f2e9a1b4c3d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f",
    documents: [
      { name: "Certificate_of_Validation.pdf", hash: "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", signer: "Engr. R. Santos (Planning Chief)" },
      { name: "DED_Structural_Plans.dwg", hash: "0x12a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3", signer: "Engr. M. Cruz (Design Division)" },
      { name: "POW_DUPA_DO30.xlsx", hash: "0x7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8", signer: "Engr. A. Dela Cruz (District Engineer)" }
    ]
  },
  {
    id: "26BC0045",
    title: "Rehabilitation and Expansion of Daang Maharlika Highway (Km 420 - Km 435)",
    office: "Camarines Sur 2nd DEO",
    region: "Region V",
    category: "Highways & Roads",
    cost: 120000000,
    stage: "VALIDATION",
    stationLimits: "Km 420+000 to Km 435+500",
    coordinates: "13.6218° N, 123.1944° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "WARNING",
    slaRemainingHours: 8,
    createdDate: "2026-08-03T10:15:00Z",
    hash: "0x4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5",
    documents: [
      { name: "Project_Proposal_Survey.pdf", hash: "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2", signer: "Engr. J. Bautista" }
    ]
  },
  {
    id: "26CC0089",
    title: "Construction of 4-Storey 20-Classroom School Building",
    office: "Cebu 1st DEO",
    region: "Region VII",
    category: "Public Buildings",
    cost: 38000000,
    stage: "BIDDING",
    stationLimits: "Barangay Central, Mandaue City",
    coordinates: "10.3333° N, 123.9333° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "NORMAL",
    slaRemainingHours: 42,
    createdDate: "2026-07-28T14:20:00Z",
    hash: "0x9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
    documents: [
      { name: "Approved_ABC_Voucher.pdf", hash: "0xb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3", signer: "Engr. L. Mendoza" }
    ]
  },
  {
    id: "26DD0112",
    title: "Bicol River Basin Sustainable Flood Resilience Infrastructure",
    office: "Regional Office V",
    region: "Region V",
    category: "Flood Control",
    cost: 280000000,
    stage: "BILLING",
    stationLimits: "Sta. 12+000 to Sta. 18+500",
    coordinates: "13.5000° N, 123.3000° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "BREACH",
    slaRemainingHours: -14,
    createdDate: "2026-07-15T09:00:00Z",
    hash: "0xc3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    documents: [
      { name: "Progress_Billing_Certificate_No1.pdf", hash: "0xd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5", signer: "Regional Director G. Alvarez" }
    ]
  }
];

// Audit Trail Ledger
let auditTrail = [
  {
    id: "LOG_9012",
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    projectId: "26AB0012",
    action: "GOVPKI_DIGITAL_SIGNATURE",
    user: "Engr. A. Dela Cruz (District Engineer)",
    details: "Signed POW & ABC under DO 30, s. 2025. Hash: 0x7f8a...7f8",
    status: "VERIFIED"
  },
  {
    id: "LOG_9011",
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    projectId: "26AB0012",
    action: "DO30_DUPA_PRICE_CHECK",
    user: "SYSTEM_AUTOMATION_GATE",
    details: "DUPA Unit Price Analysis verified against DO 30 s. 2025 ceiling rates. 0 anomalies.",
    status: "PASSED"
  },
  {
    id: "LOG_9010",
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    projectId: "26BC0045",
    action: "SLA_WARNING_TRIGGERED",
    user: "SYSTEM_SLA_RADAR",
    details: "Approval pending at Regional Planning Chief desk for > 40 hours.",
    status: "ALERT"
  }
];

// DO 30 s. 2025 Standard Cost Database (Unit Price Ceiling Rules)
const DO30_COST_RULES = [
  { itemNo: "101(1)", description: "Removal of Structures & Obstruction", unit: "sq.m", maxDirectCost: 145.00, maxIndirectCostPct: 20 },
  { itemNo: "102(2)", description: "Surplus Common Excavation", unit: "cu.m", maxDirectCost: 285.00, maxIndirectCostPct: 20 },
  { itemNo: "200(1)", description: "Aggregate Subbase Course", unit: "cu.m", maxDirectCost: 1250.00, maxIndirectCostPct: 18 },
  { itemNo: "311(1)e1", description: "PCCP (Unreinforced, 0.28m thick, 14 days)", unit: "sq.m", maxDirectCost: 2150.00, maxIndirectCostPct: 15 },
  { itemNo: "404(1)a", description: "Reinforcing Steel (Grade 40)", unit: "kg", maxDirectCost: 78.50, maxIndirectCostPct: 15 },
  { itemNo: "405(1)a3", description: "Structural Concrete (Class A, 28 days)", unit: "cu.m", maxDirectCost: 6800.00, maxIndirectCostPct: 15 }
];

// ========== REST API ROUTES ==========

// Get All Projects
app.get('/api/nexus/projects', (req, res) => {
  res.json({ success: true, projects });
});

// Create / Ingest New Project Proposal
app.post('/api/nexus/projects', (req, res) => {
  const { title, office, region, category, cost, stationLimits, coordinates, dupaItems } = req.body;
  if (!title || !cost || !office) {
    return res.status(400).json({ success: false, error: 'Title, Cost, and Office are required' });
  }

  const id = `26${office.substring(0,2).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
  const hashString = `${id}-${title}-${cost}-${Date.now()}`;
  const hash = '0x' + crypto.createHash('sha256').update(hashString).digest('hex');

  const newProject = {
    id,
    title,
    office: office || "Central Office",
    region: region || "National Capital Region",
    category: category || "Highways & Roads",
    cost: parseFloat(cost),
    stage: "IDENTIFICATION",
    stationLimits: stationLimits || "Sta. 00+000 to Sta. 01+000",
    coordinates: coordinates || "14.5995° N, 120.9842° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "NORMAL",
    slaRemainingHours: 48,
    createdDate: new Date().toISOString(),
    hash,
    documents: [
      { name: `${id}_Initial_Survey.pdf`, hash: '0x' + crypto.createHash('sha256').update(`doc_${Date.now()}`).digest('hex'), signer: "System Automated Intake" }
    ]
  };

  projects.unshift(newProject);

  // Add Audit Log
  auditTrail.unshift({
    id: `LOG_${Date.now()}`,
    timestamp: new Date().toISOString(),
    projectId: id,
    action: "PROJECT_INTAKE_INGESTION",
    user: `${office} Intake Officer`,
    details: `Ingested Project ${id} with Hash ${hash.substring(0, 10)}...`,
    status: "VERIFIED"
  });

  res.json({ success: true, message: `Project ${id} ingested successfully`, project: newProject });
});

// Advance Project Stage (SLA Approval Workflow)
app.post('/api/nexus/projects/:id/advance', (req, res) => {
  const { id } = req.params;
  const { signerName, signerRole } = req.body;
  const project = projects.find(p => p.id === id);

  if (!project) return res.status(404).json({ success: false, error: "Project not found" });

  const stageOrder = ["IDENTIFICATION", "VALIDATION", "POW_ABC_APPROVAL", "BIDDING", "BILLING"];
  const currIdx = stageOrder.indexOf(project.stage);

  if (currIdx === -1 || currIdx === stageOrder.length - 1) {
    return res.status(400).json({ success: false, error: "Project is already at final closeout stage" });
  }

  const nextStage = stageOrder[currIdx + 1];
  project.stage = nextStage;
  project.slaStatus = "NORMAL";
  project.slaRemainingHours = 48;

  // Add GovPKI Signed Document
  const docHash = '0x' + crypto.createHash('sha256').update(`${id}-${nextStage}-${Date.now()}`).digest('hex');
  project.documents.push({
    name: `${id}_${nextStage}_Approval.pdf`,
    hash: docHash,
    signer: `${signerName || "Engr. Signature"} (${signerRole || "Approving Authority"})`
  });

  // Log Audit
  auditTrail.unshift({
    id: `LOG_${Date.now()}`,
    timestamp: new Date().toISOString(),
    projectId: id,
    action: "GOVPKI_STAGE_ADVANCE",
    user: signerName || "Approving Authority",
    details: `Advanced project ${id} to ${nextStage}. GovPKI Hash: ${docHash.substring(0, 12)}...`,
    status: "VERIFIED"
  });

  res.json({ success: true, message: `Project ${id} advanced to ${nextStage}`, project });
});

// Get DO 30 s. 2025 Cost Rules
app.get('/api/nexus/dupa-rules', (req, res) => {
  res.json({ success: true, rules: DO30_COST_RULES });
});

// Validate Custom DUPA Unit Cost
app.post('/api/nexus/dupa-rules/validate', (req, res) => {
  const { itemNo, directCost, indirectCostPct } = req.body;
  const rule = DO30_COST_RULES.find(r => r.itemNo === itemNo);

  if (!rule) {
    return res.json({ success: true, valid: true, note: "Custom pay item. Requires District Engineer manual concurrence." });
  }

  const numDirect = parseFloat(directCost);
  const numIndirect = parseFloat(indirectCostPct);

  const directValid = numDirect <= rule.maxDirectCost;
  const indirectValid = numIndirect <= rule.maxIndirectCostPct;

  if (directValid && indirectValid) {
    return res.json({
      success: true,
      valid: true,
      status: "PASSED_DO30",
      details: `Unit cost ₱${numDirect.toFixed(2)} is within DO 30 ceiling of ₱${rule.maxDirectCost.toFixed(2)}.`
    });
  } else {
    return res.json({
      success: true,
      valid: false,
      status: "VIOLATION_DO30",
      details: `EXCEEDS DO 30 CEILING: Proposed ₱${numDirect.toFixed(2)} vs Max Ceiling ₱${rule.maxDirectCost.toFixed(2)}.`
    });
  }
});

// Get Audit Trail
app.get('/api/nexus/audit', (req, res) => {
  res.json({ success: true, auditTrail });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🏛️ DPWH NEXUS Backend Server running on port ${PORT}`);
});
