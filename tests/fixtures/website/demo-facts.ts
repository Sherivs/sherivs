/**
 * Fictional demo organizations (names, people and numbers are invented) used by unit tests, the sim seed and
 * the screenshot run. Shapes match website_facts(): { data: public bundle, onboarding: interview answers }.
 */
import type { Facts } from "@/lib/website/generator";

const future = (days: number) =>
  new Date(Date.UTC(2026, 10, 1) + days * 86400000).toISOString().slice(0, 10);

export const DEMO_FACTS: Record<
  "lagosNurseryPrimary" | "bornoSecondary" | "federalUniversity" | "stateBoard",
  Facts
> = {
  lagosNurseryPrimary: {
    onboarding: {
      organisation: {
        name: "Little Pearls Nursery & Primary School",
        religion: "christian",
        state: "Lagos",
      },
      institution: { bands: ["nursery", "primary"] },
      people: {
        leaders: [
          { name: "Mrs. Adaeze Okafor", title: "Head Teacher" },
          { name: "Mr. Tunde Bakare", title: "Proprietor" },
        ],
      },
      facilities: [
        "Montessori early-years room",
        "Reading corner and library",
        "Covered play area",
        "Sick bay with a nurse",
      ],
    },
    data: {
      school: {
        name: "Little Pearls Nursery & Primary School",
        slug: "little-pearls",
        motto: "Learning with joy, growing in character",
        about:
          "Little Pearls is a nursery and primary school in Lekki, Lagos. We combine the Nigerian national curriculum with Montessori methods in the early years, small classes and a warm partnership with parents.",
        mission:
          "To give every child a joyful, safe start and strong foundations in literacy, numeracy and character.",
        vision: "Confident, kind and curious children ready for secondary school.",
        founded_year: 2012,
        primary_color: "#c2185b",
        secondary_color: "#ffb300",
        phone: "+234 803 000 1122",
        email: "hello@littlepearls.sch.ng",
        address: "14 Admiralty Way, Lekki Phase 1, Lagos",
        office_hours: "Mon–Fri, 7:30am–4:00pm",
        institution_category: "k12",
        socials: { instagram: "https://instagram.com/littlepearls.demo" },
      },
      campuses: [{ name: "Lekki campus", address: "14 Admiralty Way, Lekki Phase 1, Lagos" }],
      sections: [
        {
          name: "Crèche & Nursery",
          kind: "nursery",
          gender: "mixed",
          residency: "day",
          campus: "Lekki campus",
        },
        {
          name: "Primary (Basic 1–6)",
          kind: "primary",
          gender: "mixed",
          residency: "day",
          campus: "Lekki campus",
        },
      ],
      programmes: [
        {
          name: "Crèche",
          age_range: "6 months – 2 years",
          description: "Care and play-based learning with a 1:4 adult ratio.",
        },
        {
          name: "Nursery 1–2",
          age_range: "2 – 5 years",
          description: "Montessori phonics, numbers, creative play.",
        },
        {
          name: "Primary 1–6",
          age_range: "6 – 11 years",
          description: "NERDC curriculum, French, ICT and coding club.",
        },
      ],
      news: [
        {
          id: "n1",
          title: "Inter-house sports day: Blue House wins",
          excerpt: "Parents joined us for a morning of races, drills and a tug of war.",
          published_at: "2026-10-18T09:00:00Z",
        },
        {
          id: "n2",
          title: "Primary 5 visit the Nike Art Gallery",
          excerpt: "Pupils explored Nigerian art and made their own adire patterns.",
          published_at: "2026-10-09T09:00:00Z",
        },
      ],
      events: [
        {
          id: "e1",
          title: "Open day for new parents",
          date: future(5),
          time: "10:00",
          location: "Lekki campus",
        },
        {
          id: "e2",
          title: "End-of-term Christmas concert",
          date: future(40),
          time: "11:00",
          location: "School hall",
        },
      ],
      transport: {
        coverage_areas: "Lekki Phase 1, Ikate, Chevron, Ajah",
        morning_pickup_start: "6:30am",
        afternoon_departure_time: "2:30pm",
        live_tracking_enabled: true,
        monthly_fee: 45000,
      },
      testimonials: [
        {
          name: "Mrs. Bisi Adeyemi",
          role: "Parent, Nursery 2",
          content: "My son reads simple words at four and runs to school every morning.",
        },
      ],
      faqs: [
        { question: "What age can my child start?", answer: "From six months in the crèche." },
        { question: "Do you offer after-school care?", answer: "Yes, until 5:30pm on weekdays." },
      ],
      admissions: {
        requirements:
          "Birth certificate, two passport photos, immunisation card, last school report (Primary only).",
        deadline: future(30),
        open: true,
        timeline: [],
      },
      results_checker: true,
      stats: { students: 280, teachers: 24, programmes: 3, campuses: 1, founded_year: 2012 },
    },
  },
  bornoSecondary: {
    onboarding: {
      organisation: {
        name: "Government Secondary School Gwange (demo)",
        religion: "none",
        state: "Borno",
        boarding: true,
      },
      institution: { bands: ["jss", "sss"] },
      people: {
        leaders: [
          { name: "Mal. Ibrahim Kachalla", title: "Principal" },
          { name: "Haj. Fatima Modu", title: "Vice Principal (Academics)" },
        ],
      },
      accreditation: [
        { name: "WAEC", detail: "Approved SSCE centre" },
        { name: "NECO", detail: "Approved SSCE centre" },
        { name: "Borno State Ministry of Education", detail: "Public school" },
      ],
    },
    data: {
      school: {
        name: "Government Secondary School Gwange",
        slug: "gss-gwange",
        motto: "Knowledge is light",
        about:
          "A public day and boarding secondary school serving Maiduguri and the surrounding local government areas, with junior and senior secondary sections and a science-focused senior school.",
        founded_year: 1978,
        primary_color: "#1b5e20",
        secondary_color: "#f9a825",
        phone: "+234 806 000 7788",
        address: "Gwange Ward, Maiduguri, Borno State",
        institution_category: "k12",
      },
      campuses: [{ name: "Gwange", address: "Gwange Ward, Maiduguri, Borno State" }],
      sections: [
        {
          name: "Junior Secondary (JSS 1–3)",
          kind: "junior_secondary",
          gender: "mixed",
          residency: "day",
          campus: "Gwange",
        },
        {
          name: "Senior Secondary (SS 1–3)",
          kind: "senior_secondary",
          gender: "mixed",
          residency: "both",
          campus: "Gwange",
        },
      ],
      hostels: [
        { gender: "male", rooms: 18, capacity: 216 },
        { gender: "female", rooms: 14, capacity: 168 },
      ],
      news: [
        {
          id: "n1",
          title: "SS3 students begin WAEC registration",
          excerpt: "Registration closes on Friday; see the exams office.",
          published_at: "2026-10-20T08:00:00Z",
        },
      ],
      events: [
        {
          id: "e1",
          title: "PTA general meeting",
          date: future(8),
          time: "10:00",
          location: "Assembly ground",
        },
      ],
      admissions: {
        requirements:
          "JSS 1: First School Leaving Certificate and placement test. SS 1: BECE result. Transfer: letter from previous school.",
        open: true,
        timeline: [],
      },
      results_checker: true,
      stats: { students: 1840, teachers: 62, campuses: 1, founded_year: 1978 },
    },
  },
  federalUniversity: {
    onboarding: {
      organisation: {
        name: "Federal University of Arewa (demo)",
        org_type: "university",
        state: "Kano",
      },
      people: {
        leaders: [
          { name: "Prof. Aminu Sule", title: "Vice-Chancellor" },
          { name: "Prof. Ngozi Eze", title: "Deputy Vice-Chancellor (Academic)" },
          { name: "Mrs. Halima Bello", title: "Registrar" },
        ],
      },
      faculties: [
        {
          name: "Faculty of Science",
          departments: ["Computer Science", "Mathematics", "Physics", "Biochemistry"],
        },
        {
          name: "Faculty of Engineering",
          departments: [
            "Civil Engineering",
            "Electrical/Electronic Engineering",
            "Mechanical Engineering",
          ],
        },
        {
          name: "Faculty of Social & Management Sciences",
          departments: ["Economics", "Accounting", "Mass Communication"],
        },
        {
          name: "Faculty of Education",
          departments: ["Science Education", "Educational Foundations"],
        },
      ],
      accreditation: [
        { name: "NUC", detail: "Full accreditation, 2025 cycle" },
        { name: "COREN", detail: "Engineering programmes" },
      ],
      languages: ["ha", "pcm"],
    },
    data: {
      school: {
        name: "Federal University of Arewa",
        slug: "fu-arewa",
        motto: "Knowledge, integrity and service",
        about:
          "A federal university with four faculties, established to widen access to science, engineering and teacher education in northern Nigeria.",
        mission:
          "To produce graduates with the skills, character and research capacity to serve Nigeria.",
        vision: "A leading research university in West Africa.",
        founded_year: 2011,
        primary_color: "#0d47a1",
        secondary_color: "#00897b",
        phone: "+234 809 000 3344",
        email: "registrar@fuarewa.edu.ng",
        address: "Kano–Zaria Road, Kano State",
        institution_category: "university",
      },
      campuses: [
        { name: "Main campus", address: "Kano–Zaria Road, Kano State" },
        { name: "College of Medicine (Kano city)", address: "Hospital Road, Kano" },
      ],
      programmes: [
        { name: "B.Sc. Computer Science", duration: "4 years", description: "Faculty of Science" },
        {
          name: "B.Eng. Civil Engineering",
          duration: "5 years",
          description: "Faculty of Engineering",
        },
        {
          name: "B.Sc. Economics",
          duration: "4 years",
          description: "Faculty of Social & Management Sciences",
        },
        { name: "B.Sc.(Ed.) Biology", duration: "4 years", description: "Faculty of Education" },
        { name: "M.Sc. Computer Science", duration: "2 years", description: "Postgraduate School" },
      ],
      facilities: [
        {
          name: "University library",
          description: "120,000 volumes and an e-library with 400 seats.",
        },
        { name: "Engineering workshops", description: "Civil, electrical and mechanical labs." },
        { name: "Student hostels", description: "Six halls of residence on the main campus." },
      ],
      news: [
        {
          id: "n1",
          title: "2026/2027 matriculation ceremony",
          excerpt: "3,412 new students take the matriculation oath.",
          published_at: "2026-10-15T10:00:00Z",
        },
        {
          id: "n2",
          title: "Department of Computer Science wins TETFund research grant",
          excerpt: "The grant funds work on Hausa-language speech technology.",
          published_at: "2026-10-02T10:00:00Z",
        },
      ],
      events: [
        {
          id: "e1",
          title: "Convocation lecture",
          date: future(20),
          time: "10:00",
          location: "Convocation arena",
        },
      ],
      admissions: {
        requirements:
          "UTME score of at least 180 in the relevant subjects, five O'Level credits including English and Mathematics, and the post-UTME screening.",
        deadline: future(25),
        open: true,
        timeline: [],
      },
      alumni: { verified: 6420, first_year: 2015, last_year: 2026 },
      donations: [{ id: "d1", title: "Library e-resources endowment", goal: 50000000 }],
      stats: { students: 18400, teachers: 640, programmes: 48, campuses: 2, founded_year: 2011 },
    },
  },
  stateBoard: {
    onboarding: {
      organisation: {
        name: "Borno State Universal Basic Education Board (demo)",
        org_type: "government",
        state: "Borno",
      },
      agencies: [
        {
          name: "School Support Services",
          detail: "Inspection and quality assurance for public basic schools.",
        },
        { name: "Teacher Development", detail: "In-service training and certification." },
      ],
    },
    data: {
      school: {
        name: "Borno SUBEB (demo)",
        slug: "borno-subeb",
        about:
          "Coordinating universal basic education across the state's 27 local government areas.",
        phone: "+234 802 000 0000",
        address: "Maiduguri, Borno State",
      },
      news: [
        {
          id: "n1",
          title: "New classrooms commissioned in Konduga",
          published_at: "2026-10-12T10:00:00Z",
        },
      ],
    },
  },
};
