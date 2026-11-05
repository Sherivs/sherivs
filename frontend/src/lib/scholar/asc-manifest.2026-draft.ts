export type AscFieldType = "text" | "integer";

export type AscFieldSource =
  | {
      readonly table: "schools";
      readonly tenantColumn: "id";
      readonly column: "name" | "address" | "phone" | "email";
    }
  | {
      readonly table: "school_locations";
      readonly tenantColumn: "school_id";
      readonly column: "state" | "lga" | "ownership";
    }
  | {
      readonly derivation: "active-student-count" | "active-teacher-count";
      readonly tenantColumn: "school_id";
    };

export interface AscField {
  readonly key: string;
  readonly header: string;
  readonly source: AscFieldSource;
  readonly type: AscFieldType;
}

export interface AscManifest {
  readonly revision: string;
  readonly status: "unverified-draft" | "verified";
  readonly sections: readonly {
    readonly key: string;
    readonly title: string;
    readonly fields: readonly AscField[];
  }[];
}

export const ASC_MANIFEST_2026_DRAFT: AscManifest = {
  revision: "ng-schema-draft-2026-11",
  status: "unverified-draft",
  sections: [
    {
      key: "school_profile",
      title: "School profile",
      fields: [
        {
          key: "school_name",
          header: "School name",
          source: { table: "schools", tenantColumn: "id", column: "name" },
          type: "text",
        },
        {
          key: "school_address",
          header: "School address",
          source: { table: "schools", tenantColumn: "id", column: "address" },
          type: "text",
        },
        {
          key: "school_phone",
          header: "School phone",
          source: { table: "schools", tenantColumn: "id", column: "phone" },
          type: "text",
        },
        {
          key: "school_email",
          header: "School email",
          source: { table: "schools", tenantColumn: "id", column: "email" },
          type: "text",
        },
        {
          key: "state",
          header: "State",
          source: { table: "school_locations", tenantColumn: "school_id", column: "state" },
          type: "text",
        },
        {
          key: "lga",
          header: "LGA",
          source: { table: "school_locations", tenantColumn: "school_id", column: "lga" },
          type: "text",
        },
        {
          key: "ownership",
          header: "Ownership",
          source: { table: "school_locations", tenantColumn: "school_id", column: "ownership" },
          type: "text",
        },
      ],
    },
    {
      key: "current_enrolment",
      title: "Current enrolment and teaching staff",
      fields: [
        {
          key: "active_student_count",
          header: "Current active student count",
          source: { derivation: "active-student-count", tenantColumn: "school_id" },
          type: "integer",
        },
        {
          key: "active_teacher_count",
          header: "Current active teacher count",
          source: { derivation: "active-teacher-count", tenantColumn: "school_id" },
          type: "integer",
        },
      ],
    },
  ],
};
