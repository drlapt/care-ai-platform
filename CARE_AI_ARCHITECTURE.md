# PROJECT CARE AI — MASTER PRODUCT ARCHITECTURE

**Version:** 1.1
**Status:** Living document — updated each sprint

---

# PRODUCT VISION

CARE AI is not a chatbot.

CARE AI is a longitudinal care operating system built around:

1. Identity
2. Memory
3. Workflow
4. Continuity

The goal is to reduce cognitive load for patients and doctors while maintaining continuous, longitudinal care over time.

CARE AI should feel like a trusted junior doctor who remembers the patient across every interaction.

---

# CORE PRODUCT PRINCIPLES

1. Identity before consultation
2. Workflow before features
3. Voice before typing
4. Continuity before isolated visits
5. Memory before repetition
6. Low cognitive load
7. Human conversation over forms
8. Clinical safety above automation

---

# CARE AI ROLE DEFINITION

CARE AI is an AI Junior Doctor.

CARE AI is NOT:

* a chatbot
* a symptom checker
* a search engine
* a replacement for doctors

CARE AI exists:

Before consultation
During consultation
After consultation

Responsibilities:

* Collect structured history
* Maintain longitudinal memory
* Generate clinical handoffs
* Support doctors
* Support follow-up care
* Detect deterioration patterns
* Improve continuity

---

# CLINICAL SAFETY PRINCIPLES

CARE AI must never:

* invent prescriptions
* invent medication dosages
* invent diagnoses
* invent physician instructions
* override physician decisions

Doctor instructions are always the source of truth.

If uncertain:

* ask
* escalate
* clarify

Never hallucinate clinical information.

---

# SYSTEM ARCHITECTURE

CARE AI consists of five layers:

Layer 1 → Patient Identity System

Layer 2 → Consultation Operating System

Layer 3 → Doctor Workspace

Layer 4 → Health Record Vault

Layer 5 → Longitudinal Intelligence

---

# LAYER 1 — PATIENT IDENTITY SYSTEM

## Purpose

CARE AI must always know who is being treated.

Identity comes before consultation.

One account may manage up to 5 profiles.

Example:

* Self
* Father
* Mother
* Child
* Guest

---

## PROFILE STRUCTURE

### Identity

* Full Name
* DOB
* Age (derived automatically)
* Gender
* Relationship

### Vitals

* Height
* Weight
* BMI
* Blood Group

### Clinical

* Conditions
* Medications
* Allergies
* Surgeries
* Family History

### CARE Memory

Examples:

* Preferred language
* Communication preferences
* Medication adherence concerns
* Lifestyle notes
* Continuity notes

---

## PROFILE CREATION PRINCIPLES

Profile creation must take less than 60 seconds.

Avoid large forms.

Prefer conversational collection.

Prefer voice input.

Target flow:

Relationship
→ CARE AI Introduction
→ Voice/Chat Collection
→ Confirmation
→ Profile Created

---

## PROFILE COMPLETENESS ENGINE

Profile completeness is a score from 0–100 used to measure how much CARE AI knows about a patient.

Scoring formula:

| Field                     | Points |
|---------------------------|--------|
| Name                      | 20     |
| Date of Birth (DOB)       | 15     |
| Gender                    | 10     |
| Height + Weight (BMI-ready) | 15   |
| Blood Group               | 10     |
| Conditions recorded       | 10     |
| Medications recorded      | 10     |
| Allergies recorded        | 10     |

Maximum: 100 points.

A profile at < 50% completeness should prompt the patient to add missing fields before consultation.

---

## BMI CALCULATION RULES

BMI is derived automatically when both height (cm) and weight (kg) are recorded.

Formula: BMI = weight_kg / (height_m)²

BMI is recalculated on every profile update that changes height or weight.

BMI is stored on the profile and surfaced in:

* Profile card
* Consultation profile step
* Doctor clinical handoff

---

## DOB → AGE DERIVATION

Age is never entered manually if DOB is available.

Age is derived dynamically from DOB using: age = current_year − birth_year (accounting for month/day).

If DOB is stored, the system always derives age at runtime.

Manual age entry is only used as fallback when DOB is unknown.

---

# MEMORY HIERARCHY

## Level 1

Profile Memory

* Name
* DOB
* Gender
* Height
* Weight

## Level 2

Clinical Memory

* Conditions
* Medications
* Allergies
* Surgeries

## Level 3

Consultation Memory

* Consultations
* Prescriptions
* Doctor Recommendations

## Level 4

Longitudinal Memory

* Trends
* Disease Progression
* Adherence Patterns

## Level 5

Contextual Memory

* Language
* Preferences
* Lifestyle Context

---

# LAYER 2 — CONSULTATION OPERATING SYSTEM

## Core Flow

Login
→ Dashboard
→ Consult Now
→ Choose Profile
→ Department
→ Doctor
→ Slot
→ CARE AI Intake
→ Patient Approval
→ Clinical Handoff
→ Doctor Consultation
→ Prescription
→ Follow-Up

---

## CARE AI INTAKE PRINCIPLES

CARE AI should behave like a junior doctor.

It must:

* Know profile information
* Know conditions
* Know medications
* Know allergies
* Know demographics

It should only ask for missing information.

Never ask age if DOB exists.

Never repeatedly ask known information.

---

## CONVERSATIONAL DESIGN PRINCIPLES

CARE AI should feel human.

Avoid:

Question
Answer
Question
Answer

Prefer:

Natural conversation

One focused question at a time.

Acknowledge concerns.

Avoid robotic interactions.

Avoid form-filling behavior.

---

## CLINICAL HANDOFF

Doctor should receive:

* Chief Complaint
* HPI
* Associated Symptoms
* Medications
* Allergies
* Conditions
* Reports
* Red Flags
* Structured Summary

Doctor should understand the case within 1–2 minutes.

---

# LAYER 3 — DOCTOR WORKSPACE

## Purpose

Reduce doctor cognitive load.

Doctor Dashboard should feel like a Clinical Command Center.

Not an admin dashboard.

---

## Workspace Layout

Left Panel

* Waiting Queue
* Follow-Up Queue

Center Panel

* Active Consultation
* Clinical Handoff
* Consultation Controls

Right Panel

* Alerts
* CARE AI Suggestions
* Follow-Up Context

---

## Future Features

* Voice Commands
* Real-Time Scribe
* SOAP Notes
* Live Transcript
* AI Recommendations

---

# LAYER 4 — HEALTH RECORD VAULT

## Purpose

Store longitudinal health history.

Separate from Profile.

---

## Stores

* Reports
* Prescriptions
* Consultations
* Vitals
* Follow-Ups
* Alerts

---

## Timeline Model

Every event should be stored chronologically.

Example:

2024

* Health Checkup

2025

* Thyroid Report

2026

* Diabetes Review

Patient should be able to review history at any time.

---

# LAYER 5 — LONGITUDINAL INTELLIGENCE

## Purpose

Transform historical data into clinical insight.

---

## Trend Engine

Examples:

TSH

2024 → 5.6
2025 → 7.8
2026 → 8.9

CARE AI:

"Thyroid control appears to be worsening."

---

HbA1c

2024 → 6.4
2025 → 7.2
2026 → 8.1

CARE AI:

"Diabetes control appears to be worsening."

---

Weight

2024 → 82kg
2025 → 89kg
2026 → 95kg

CARE AI:

"Weight trend increasing."

---

## Future Intelligence

* Risk Scoring
* Deterioration Detection
* Escalation Recommendations
* Disease Progression Tracking
* Care Coordination

---

# ADMIN OPERATIONS CENTER

Purpose:

Human-in-the-loop oversight.

Functions:

* Doctor Management
* Patient Management
* Escalation Review
* AI Monitoring
* Quality Assurance
* Safety Review
* Operations Analytics

---

# SPRINT ROADMAP

## Sprint 0

Stabilization

Status: COMPLETE

---

## Sprint 1

Operations Foundation

Status: COMPLETE

---

## Sprint 2.1

Patient Identity System

Deliverables:

* DOB → Age Derivation
* Profile Validation
* BMI
* Profile Completeness Engine
* Profile Editing
* Profile-Centric Consultation Entry

Status: ACTIVE

---

## Sprint 2.2

Living Health Record

Deliverables:

* Conditions
* Medications
* Allergies
* CARE Memory
* Dynamic Profile Enrichment

---

## Sprint 2.3

Profile-Centric Consultation

Deliverables:

* Consultation linked to profile
* Demographic reuse
* No repeated questions

---

## Sprint 3

Consultation Intelligence

Deliverables:

* Conversational Intake
* Better Clinical Handoff
* Patient Approval
* Media Understanding
* Report Understanding

---

## Sprint 4

Doctor Workspace

Deliverables:

* Dashboard Redesign
* Voice Commands
* Real-Time Scribe
* Doctor Intervention Workflow

---

## Sprint 5

Continuity Layer

Deliverables:

* WhatsApp Integration
* Medication Reminders
* Follow-Up Automation
* Adherence Tracking

---

## Sprint 6

Longitudinal Intelligence

Deliverables:

* Trend Engine
* Risk Engine
* Deterioration Detection
* Care Coordination

---

# IMPLEMENTATION NOTES

## Profile Data Model

Each profile document contains:

```
personal_info:
  name          (required)
  dob           (ISO date string, e.g. "1990-04-15")
  age           (derived from dob at runtime; fallback manual entry)
  gender        (male | female | other | prefer_not_to_say)
  height_cm     (float)
  weight_kg     (float)
  bmi           (derived: weight_kg / (height_m)²)
  blood_group   (A+ | A- | B+ | B- | AB+ | AB- | O+ | O-)

relationship    (self | mother | father | spouse | child | sibling | family | guest)
profile_completeness  (0–100 integer, recalculated on every update)
medical_history:
  allergies      []
  current_conditions  []
  current_medications []
medical_facts   (confirmed structured clinical facts)
pending_facts   (unconfirmed suggestions from AI)
```

## Consultation Flow

Step 0: Profile selection (who is this consultation for?)
Step 1: Department selection
Step 2: Doctor selection
Step 3: Date + time slot
Step 4: Reason / chief complaint
→ Appointment created → CARE AI intake begins

## Clinical Safety

CARE AI never invents:
* Diagnoses
* Prescriptions
* Medication dosages
* Doctor instructions

All clinical decisions require doctor confirmation.
