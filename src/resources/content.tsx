import type { About, Blog, Gallery, Home, Newsletter, Person, Social, Work } from "@/types";
import { Line, Row, Text } from "@once-ui-system/core";

const person: Person = {
  firstName: "Binh",
  lastName: "Phan",
  name: "Binh Phan",
  role: "Frontend Developer",
  avatar: "/images/binh-avatar.jpg",
  email: "binhphan.dev@proton.me",
  location: "Asia/Ho_Chi_Minh", // Expecting the IANA time zone identifier, e.g., 'Europe/Vienna'
  languages: ["Vietnamese", "English"], // optional: Leave the array empty if you don't want to display languages
};

const newsletter: Newsletter = {
  display: false,
  title: <>Subscribe to {person.firstName}'s Newsletter</>,
  description: <>My weekly newsletter about creativity and engineering</>,
};

const social: Social = [
  // Links are automatically displayed.
  // Import new icons in /once-ui/icons.ts
  // Set essentials: true for links you want to show on the about page
  {
    name: "GitHub",
    icon: "github",
    link: "https://github.com/binhphanbp",
    essential: true,
  },
  {
    name: "LinkedIn",
    icon: "linkedin",
    link: "https://www.linkedin.com/in/bianbp150504/",
    essential: true,
  },
  {
    name: "Facebook",
    icon: "facebook",
    link: "https://web.facebook.com/bianbp150504",
    essential: true,
  },
  {
    name: "Instagram",
    icon: "instagram",
    link: "https://www.instagram.com/bianbp_1505",
    essential: false,
  },
  {
    name: "Email",
    icon: "email",
    link: `mailto:${person.email}`,
    essential: true,
  },
];

const home: Home = {
  path: "/",
  image: `/api/og/generate?title=${encodeURIComponent(`${person.name}'s Portfolio`)}`,
  label: "Home",
  title: `${person.name}'s Portfolio`,
  description: `Portfolio website showcasing my work as a ${person.role}`,
  headline: <>Crafting seamless web experiences with modern frontend</>,
  featured: {
    display: false,
    title: (
      <Row gap="12" vertical="center">
        <strong className="ml-4">Latest Project</strong>{" "}
        <Line background="brand-alpha-strong" vert height="20" />
        <Text marginRight="4" onBackground="brand-medium">
          Featured work
        </Text>
      </Row>
    ),
    href: "/work",
  },
  subline: (
    <>
      I'm Binh, a passionate{" "}
      <Text as="span" size="xl" weight="strong">
        Frontend Developer
      </Text>{" "}
      based in Vietnam, specializing in building <br /> modern, responsive, and user-friendly web
      applications.
    </>
  ),
};

const about: About = {
  path: "/about",
  label: "About",
  title: `About – ${person.name}`,
  description: `Meet ${person.name}, ${person.role} from ${person.location}`,
  tableOfContent: {
    display: true,
    subItems: false,
  },
  avatar: {
    display: true,
  },
  calendar: {
    display: false,
    link: "https://cal.com",
  },
  intro: {
    display: true,
    title: "Introduction",
    description: (
      <>
        Binh Phan is a Ho Chi Minh City-based frontend developer with a strong passion for building
        clean, performant, and user-centric web applications. With hands-on experience in React,
        Next.js, and modern frontend technologies, he thrives on transforming complex requirements
        into intuitive digital experiences. Always eager to learn and grow, he continuously explores
        new tools and best practices to deliver high-quality code.
      </>
    ),
  },
  work: {
    display: true, // set to false to hide this section
    title: "Work Experience",
    experiences: [
      {
        company: "CFD Studio",
        timeframe: "Aug 2025 - Dec 2025",
        role: "Intern Frontend Developer",
        achievements: [
          <span key="cfd-1">
            Collaborated with the development team to build and maintain responsive web interfaces
            using React and modern frontend frameworks.
          </span>,
          <span key="cfd-2">
            Gained hands-on experience in component-driven development, state management, and
            integrating RESTful APIs into production-level applications.
          </span>,
        ],
        images: [],
      },
    ],
  },
  studies: {
    display: true, // set to false to hide this section
    title: "Studies",
    institutions: [
      {
        name: "Ho Chi Minh City University of Technology and Education",
        description: <>Studied Information Technology (2022 - 2024).</>,
      },
      {
        name: "FPT Polytechnic",
        description: <>Studying Frontend Development (2024 - Present).</>,
      },
    ],
  },
  technical: {
    display: true, // set to false to hide this section
    title: "Technical skills",
    skills: [
      {
        title: "React & Next.js",
        description: (
          <>
            Building modern, performant web applications with React ecosystem including Redux for
            state management and Next.js for server-side rendering.
          </>
        ),
        tags: [
          {
            name: "React",
            icon: "react",
          },
          {
            name: "Next.js",
            icon: "nextjs",
          },
          {
            name: "Redux",
            icon: "redux",
          },
        ],
        // optional: leave the array empty if you don't want to display images
        images: [],
      },
      {
        title: "TypeScript & JavaScript",
        description: (
          <>
            Proficient in both JavaScript and TypeScript for building type-safe, scalable frontend
            and full-stack applications.
          </>
        ),
        tags: [
          {
            name: "JavaScript",
            icon: "javascript",
          },
          {
            name: "TypeScript",
            icon: "typescript",
          },
        ],
        // optional: leave the array empty if you don't want to display images
        images: [],
      },
      {
        title: "Styling & UI",
        description: (
          <>
            Creating beautiful, responsive interfaces with TailwindCSS and modern CSS techniques for
            pixel-perfect designs.
          </>
        ),
        tags: [
          {
            name: "TailwindCSS",
            icon: "tailwind",
          },
        ],
        // optional: leave the array empty if you don't want to display images
        images: [],
      },
      {
        title: "Backend & Database",
        description: (
          <>
            Familiar with Node.js, Express.js for server-side development and working with databases
            including MongoDB, MySQL, and PostgreSQL.
          </>
        ),
        tags: [
          {
            name: "Node.js",
            icon: "nodejs",
          },
          {
            name: "MongoDB",
            icon: "mongodb",
          },
        ],
        // optional: leave the array empty if you don't want to display images
        images: [],
      },
    ],
  },
};

const blog: Blog = {
  path: "/blog",
  label: "Blog",
  title: "Stories, awards, and student highlights",
  description: `Press and school stories featuring ${person.name}`,
  // Create new blog posts by adding a new .mdx file to app/blog/posts
  // All posts will be listed on the /blog route
};

const work: Work = {
  path: "/work",
  label: "Work",
  title: `Projects – ${person.name}`,
  description: `Frontend projects by ${person.name}`,
  // Create new project pages by adding a new .mdx file to app/blog/posts
  // All projects will be listed on the /home and /work routes
};

const gallery: Gallery = {
  path: "/gallery",
  label: "Gallery",
  title: `Photo gallery – ${person.name}`,
  description: `A photo collection by ${person.name}`,
  images: [
    {
      src: "/images/gallery/z7859524825595_4470905098311f7ae5cc5a336efe2f25.jpg",
      alt: "Binh Phan gallery photo 01",
      orientation: "vertical",
    },
    {
      src: "/images/gallery/z7859524844801_087189511a432e6466e7b2fb97dd65aa.jpg",
      alt: "Binh Phan gallery photo 02",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524878759_748b0733c83b9bc8390b1f05d0e539d0.jpg",
      alt: "Binh Phan gallery photo 03",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524838463_e2c022bbc42928108f45d63fee11e2ed.jpg",
      alt: "Binh Phan gallery photo 04",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524846018_d8f4845468acfbff667240b5f6d63e5c.jpg",
      alt: "Binh Phan gallery photo 05",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524853603_ca9cf8035fe460357cf0ac9e0ccb5e32.jpg",
      alt: "Binh Phan gallery photo 06",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524862084_3a29c33ebfc4a8cdca889eb0fc4be462.jpg",
      alt: "Binh Phan gallery photo 07",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524864805_b56e4ff6f7dd9b4ff96140c438fa6a2a.jpg",
      alt: "Binh Phan gallery photo 08",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524860352_00e5dd919ce584c5f3dc63c2a8710208.jpg",
      alt: "Binh Phan gallery photo 09",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524877906_1f291ba5f0eb1c01366587c7febcf69b.jpg",
      alt: "Binh Phan gallery photo 10",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524877775_caa74e56a8c4b5fa00e904e117d67f36.jpg",
      alt: "Binh Phan gallery photo 11",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524895461_15c74614c521cb536ec6797beeff180a.jpg",
      alt: "Binh Phan gallery photo 12",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/z7859524889574_66707b128e29b7a04dc218c632e94317.jpg",
      alt: "Binh Phan gallery photo 13",
      orientation: "horizontal",
    },
  ],
};

export { person, social, newsletter, home, about, blog, work, gallery };
