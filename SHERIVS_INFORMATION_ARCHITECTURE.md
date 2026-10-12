# SHERIVS INFORMATION ARCHITECTURE (SIA-v1.0)
**System:** Entity Models, Taxonomies, and Navigation Hierarchies  
**Status:** Canonical IA Specification  

---

## 1. Information Organization Philosophy

Sherivs models institutions as dynamic, observable systems rather than static relational databases. Information is structured across five primary cognitive layers:

```
[ LAYER 5: GOVERNANCE & POLICY ]
  Authority, Dual-Control Approvals, Audit Logs, Risk Boundaries
                    ▲
[ LAYER 4: MISSIONS & ORCHESTRATION ]
  Missions, Intents, Leases, Workforces, Executions, Outcomes
                    ▲
[ LAYER 3: INTELLIGENCE & REASONING ]
  Jarvis, Memory Currency, Knowledge Graphs, Context Inferences
                    ▲
[ LAYER 2: ACTIVITY & EVENTS ]
  Mutations, Attendance, Payments, Communications, Telemetry
                    ▲
[ LAYER 1: ORGANIZATIONAL REALITY ]
  Identities, Teams, Facilities, Assets, Runtimes, Physical Twins
```

---

## 2. Global Entity Taxonomy

| Entity Class | Primitives | Representation in UI | Primary Relationships |
|---|---|---|---|
| **Identity** | User, Worker, Agent, System | Avatar + Name + Role Badge + Verification Hash | Belongs to Organization, holds Roles, assigned to Missions |
| **Organization** | Tenant, Campus, Department, Division | Institutional Lockup + Domain + Status Indicator | Owns Reality Entities, configures Runtimes, sets Policies |
| **Mission** | Intent, Lease, Plan, Dependency, Outcome | Mission Card + Status Gauge + Evidence Hash | Executed by Worker, verified by Independent Actor |
| **Reality Object** | Asset, Facility, Device, Document | Physical Coordinates + Telemetry + State | Linked to Twins, observed by Hermes/Sensors |
| **Intelligence** | Memory Vector, Insight, Recommendation | Reasoning Block + Confidence Gauge + Citations | Derived from Events, submitted to Human Approvers |
| **Evidence** | Cryptographic Signature, Timestamp, Audit Log | Integrity Lockup + Dual-Signatory Seal | Attached to Missions, transactions, and mutations |

---

## 3. Universal Navigation Architecture

The navigation system avoids deep, confusing nested menus by utilizing a **Three-Tier Spatial System**:

1. **Context Switcher (Macro Tier):**
   - Allows switching between the active Organization, active Workspace, and active Domain Runtime without losing state.
2. **Contextual Sidebar (Meso Tier):**
   - Dynamically populated based on the viewer’s active role and authorized capabilities:
     - **Operations:** Reality, Work, Calendar, Messages.
     - **Intelligence:** Jarvis Assistant, Autonomous Memory, Knowledge Graph.
     - **Workforce:** AI Agents, Mission Dispatch, Execution Logs.
     - **Governance:** Policy Rules, Identity Registry, Audit Trail, Settings.
3. **In-Page Filter Rails & Tabs (Micro Tier):**
   - Horizontal segmented controls allowing rapid shifts between list views, timeline views, analytical charts, and configuration panels.
