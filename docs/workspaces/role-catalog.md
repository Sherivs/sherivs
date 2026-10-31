# Role template catalog

Version: 1.0.0 (V1 organizational capability envelope)

This is a data catalog, not an assignment or authorization mechanism. Enabled templates are limited to the approved V1 institution roles; disabled templates cannot be assigned. Candidate authority, tertiary-office, and Sangaya/Islamiyya templates have mandate_status unverified and cannot be assigned; no legal mandate is asserted. All permissions refer to existing catalog primitives. Qualification and registration entries are placeholders pending local verification.

## Institution types

- `public_primary`
- `private_primary`
- `public_secondary`
- `private_secondary`
- `nursery_ecce`
- `boarding`
- `technical_vocational`
- `university`
- `polytechnic`
- `college_of_education`
- `college_of_health_sciences_and_technology`
- `college_of_nursing_and_midwifery`
- `college_of_agriculture`
- `islamiyya_sangaya`
- `multi_campus_group`
- `multi_shift`
- `government_authority`
- `education_ministry_or_agency`
- `local_education_authority`
- `education_board`
- `teacher_service_authority`
- `quality_assurance_authority`

## Role templates

| Template                                                  | Workspace category        | V1 status | Default data scope  |
| --------------------------------------------------------- | ------------------------- | --------- | ------------------- |
| Proprietor / group director                               | institutional_executive   | Enabled   | institution_group   |
| Principal / head teacher                                  | institutional_executive   | Enabled   | institution         |
| Vice-principal                                            | institutional_executive   | Enabled   | campus              |
| Campus head                                               | institutional_executive   | Enabled   | campus              |
| Vice-chancellor                                           | institutional_executive   | Disabled  | institution         |
| Deputy vice-chancellor                                    | institutional_executive   | Disabled  | institution         |
| Rector / provost                                          | institutional_executive   | Disabled  | institution         |
| Dean                                                      | academic_teaching         | Disabled  | department          |
| Institution board member                                  | institutional_executive   | Disabled  | institution         |
| Class teacher                                             | academic_teaching         | Enabled   | class               |
| Subject teacher                                           | academic_teaching         | Enabled   | subject             |
| Examinations officer                                      | academic_teaching         | Enabled   | department          |
| Bursar                                                    | administrative_operations | Enabled   | institution         |
| Administration / HR                                       | administrative_operations | Enabled   | institution         |
| Accountant                                                | administrative_operations | Disabled  | institution         |
| Cashier                                                   | administrative_operations | Disabled  | institution         |
| Payroll officer                                           | administrative_operations | Disabled  | institution         |
| Internal auditor                                          | administrative_operations | Disabled  | institution         |
| Admissions officer                                        | administrative_operations | Disabled  | institution         |
| Academic coordinator                                      | academic_teaching         | Disabled  | department          |
| Teaching assistant                                        | academic_teaching         | Disabled  | class               |
| Teaching-practice supervisor                              | academic_teaching         | Disabled  | department          |
| Technical instructor                                      | academic_teaching         | Disabled  | department          |
| School counsellor                                         | academic_teaching         | Disabled  | department          |
| Librarian                                                 | academic_teaching         | Disabled  | department          |
| Special education teacher                                 | academic_teaching         | Disabled  | class               |
| Institution registrar                                     | administrative_operations | Disabled  | institution         |
| Head of department                                        | academic_teaching         | Disabled  | department          |
| Lecturer                                                  | academic_teaching         | Disabled  | department          |
| Clinical instructor                                       | academic_teaching         | Disabled  | department          |
| Agricultural fieldwork instructor                         | academic_teaching         | Disabled  | department          |
| Research supervisor                                       | academic_teaching         | Disabled  | department          |
| Sangaya / Islamiyya learning facilitator                  | academic_teaching         | Disabled  | class               |
| Adult student                                             | student_parent_family     | Disabled  | own_record          |
| Pupil learner                                             | student_parent_family     | Disabled  | own_record          |
| Parent / legal guardian                                   | student_parent_family     | Disabled  | linked_children     |
| Verified caregiver                                        | student_parent_family     | Disabled  | linked_children     |
| Fee payer                                                 | student_parent_family     | Disabled  | own_record          |
| Student representative                                    | student_parent_family     | Disabled  | own_record          |
| Alumnus                                                   | student_parent_family     | Disabled  | own_record          |
| Local education authority education secretary (candidate) | government_oversight      | Disabled  | authority_aggregate |
| Quality assurance inspector (candidate)                   | government_oversight      | Disabled  | authority_aggregate |
| BOSASEB desk officer (candidate)                          | government_oversight      | Disabled  | authority_aggregate |
| Education commissioner (candidate)                        | government_oversight      | Disabled  | authority_aggregate |
| Permanent secretary (candidate)                           | government_oversight      | Disabled  | authority_aggregate |

## Candidate Borno State institution-authority relationships

All rows below are unverified candidates with no asserted mandate. Official names, responsibilities, and mandates must be confirmed before use. Effective dates are unset because none are verified.

| Institution candidate                                         | Authority candidate                                                    | Verification |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ |
| Local education authority (candidate)                         | SUBEB (candidate authority; mandate unverified)                        | unverified   |
| Local education authority (candidate)                         | Education ministry or agency (candidate authority; mandate unverified) | unverified   |
| Public school teachers (candidate relationship)               | TESCOM / teachers service authority (candidate; division unconfirmed)  | unverified   |
| Senior secondary institutions (candidate relationship)        | BSSSEB / secondary education board (candidate; scope unverified)       | unverified   |
| Sangaya / Islamiyya-type institution (candidate relationship) | Relevant board (candidate authority; identity and mandate unverified)  | unverified   |
| Private schools (candidate relationship)                      | Education ministry or agency (candidate authority; mandate unverified) | unverified   |
