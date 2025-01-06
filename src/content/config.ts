import { defineCollection, z } from 'astro:content';

// Common fields between GY11 and GY25
const commonFields = {
  code: z.string(),
  name: z.string(),
  typeOfSyllabus: z.string(),
  startDate: z.string(),
  modifiedDate: z.string(),
  skolfsGrund: z.string().optional(),
  skolfsAndring: z.string().optional(),
  nameHeading: z.string().optional(),
  lastUpdated: z.string().datetime()
};

// Schema for GY11 subjects
const gy11Schema = z.object({
  ...commonFields,
  englishName: z.string().optional(),
  version: z.literal('gy11'),
  versionInfo: z.string().optional(),
  description: z.string().optional(),
  purpose: z.string().optional(),
  purposeHeading: z.string().optional(),
  courses: z.array(z.object({
    code: z.string(),
    name: z.string(),
    codeHeading: z.string().optional(),
    nameHeading: z.string().optional(),
    points: z.string().optional(),
    description: z.string().optional(),
    centralCntHeading: z.string().optional(),
    centralContent: z.object({
      text: z.string()
    }).optional(),
    knowledgeRequirements: z.array(z.object({
      text: z.string(),
      gradeStep: z.string()
    })).optional()
  })).optional(),
});

// Schema for GY25 subjects
const gy25Schema = z.object({
  ...commonFields,
  version: z.literal('gy25'),
  versionInfo: z.string().optional(),
  description: z.string().optional(),
  purposeHeading: z.string().optional(),
  purpose: z.string().optional(),
  categories: z.array(z.object({
    name: z.string()
  })).optional(),
  courses: z.array(z.object({
    code: z.string(),
    name: z.string(),
    codeHeading: z.string().optional(),
    nameHeading: z.string().optional(),
    points: z.string().optional(),
    description: z.string().optional(),
    centralCntHeading: z.string().optional(),
    centralContent: z.object({
      text: z.string()
    }).optional(),
    knowledgeRequirements: z.array(z.object({
      text: z.string(),
      gradeStep: z.string()
    })).optional()
  })).optional(),
  knowledgeReqsHeading: z.string().optional(),
  knowledgeRequirements: z.array(z.object({
    text: z.string(),
    gradeStep: z.string()
  })).optional(),
});

// Schema for API metadata
const metadataSchema = z.object({
  apiVersion: z.string(),
  apiReleased: z.string(),
  apiStatus: z.string(),
});

// Define collections
export const collections = {
  'gy11-subjects': defineCollection({
    type: 'data',
    schema: gy11Schema,
  }),
  'gy25-subjects': defineCollection({
    type: 'data',
    schema: gy25Schema,
  }),
  'metadata': defineCollection({
    type: 'data',
    schema: metadataSchema,
  }),
};
