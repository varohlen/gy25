import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

const CONTENT_DIR = path.join(process.cwd(), 'src', 'content');

// API endpoints
const API_BASE = 'https://api.skolverket.se/syllabus/v1';
const ENDPOINTS = {
  gy11: {
    subjectsList: `${API_BASE}/subjects?schooltype=GY&timespan=LATEST&typeOfSyllabus=SUBJECT_SYLLABUS`,
    subject: (code: string) => `${API_BASE}/subjects/${code}`,
  },
  gy25: {
    subjectsList: `${API_BASE}/subjects?schooltype=GY&timespan=FUTURE&typeOfSyllabus=GRADE_SUBJECT_SYLLABUS`,
    subject: (code: string) => `${API_BASE}/subjects/${code}?date=2025-08-01`,
  },
};

interface Subject {
  code: string;
  name: string;
  description?: string;
  version: number;
  startDate: string;
  modifiedDate: string;
  typeOfSyllabus: string;
  categories: Array<{
    name: string;
    code: string;
  }>;
  schoolTypes: string[];
  courses?: Array<{
    code: string;
    name: string;
    points: string;
    sortOrder: number;
  }>;
}

interface APIMetadata {
  apiVersion: string;
  apiReleased: string;
  apiStatus: string;
}

async function ensureDirectoryExists(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function fetchData(url: string) {
  try {
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching from ${url}:`, error);
    throw error;
  }
}

async function fetchSubjectDetails(code: string, version: 'gy11' | 'gy25'): Promise<Subject> {
  const url = ENDPOINTS[version].subject(code);
  console.log(`Fetching ${version} subject details for ${code}...`);
  const response = await fetchData(url);
  
  if (!response.subject) {
    throw new Error(`No subject data found in response for ${code}`);
  }
  
  return response.subject;
}

async function saveContent(subjects: Subject[], version: string) {
  const dir = path.join(CONTENT_DIR, `${version}-subjects`);
  await ensureDirectoryExists(dir);

  for (const subject of subjects) {
    try {
      const filePath = path.join(dir, `${subject.code}.json`);
      const content = {
        ...subject,
        version,
        lastUpdated: new Date().toISOString(),
      };
      await fs.writeFile(filePath, JSON.stringify(content, null, 2));
      console.log(`Saved ${version} subject ${subject.code} (${subject.name})`);
    } catch (error) {
      console.error(`Failed to save subject ${subject.code}:`, error);
    }
  }
}

async function processSubjectsWithDetails(data: any, version: 'gy11' | 'gy25'): Promise<Subject[]> {
  if (!data.subjects) {
    throw new Error('No subjects found in API response');
  }

  const subjects: Subject[] = [];
  for (const subject of data.subjects) {
    try {
      // Add a small delay between requests to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
      const detailedSubject = await fetchSubjectDetails(subject.code, version);
      subjects.push(detailedSubject);
    } catch (error) {
      console.error(`Failed to fetch details for ${subject.code}:`, error);
      // Include basic subject info even if details fetch fails
      subjects.push(subject);
    }
  }
  return subjects;
}

async function getAPIMetadata(): Promise<APIMetadata> {
  // Use any endpoint to get the API metadata
  const url = ENDPOINTS.gy11.subjectsList;
  const response = await fetchData(url);
  return {
    apiVersion: response.apiVersion,
    apiReleased: response.apiReleased,
    apiStatus: response.apiStatus,
  };
}

async function loadLastAPIMetadata(): Promise<APIMetadata | null> {
  const metadataPath = path.join(CONTENT_DIR, 'metadata', 'api.json');
  try {
    const data = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveAPIMetadata(metadata: APIMetadata): Promise<void> {
  const dir = path.join(CONTENT_DIR, 'metadata');
  await ensureDirectoryExists(dir);
  const filePath = path.join(dir, 'api-metadata.json');
  await fs.writeFile(filePath, JSON.stringify(metadata, null, 2));
}

async function main() {
  try {
    // Check API metadata
    console.log('Checking API version...');
    const currentMetadata = await getAPIMetadata();
    const lastMetadata = await loadLastAPIMetadata();

    if (lastMetadata && 
        lastMetadata.apiVersion === currentMetadata.apiVersion && 
        lastMetadata.apiReleased === currentMetadata.apiReleased) {
      console.log('API version unchanged, no update needed.');
      console.log('Current version:', currentMetadata.apiVersion);
      console.log('Released:', currentMetadata.apiReleased);
      console.log('Status:', currentMetadata.apiStatus);
      return;
    }

    console.log('New API version detected!');
    console.log('Previous version:', lastMetadata?.apiVersion);
    console.log('New version:', currentMetadata.apiVersion);
    console.log('Released:', currentMetadata.apiReleased);
    console.log('Status:', currentMetadata.apiStatus);

    // Fetch and save Gy11 data
    console.log('\nFetching Gy11 subjects list...');
    const gy11Data = await fetchData(ENDPOINTS.gy11.subjectsList);
    const gy11Subjects = await processSubjectsWithDetails(gy11Data, 'gy11');
    await saveContent(gy11Subjects, 'gy11');
    console.log(`Processed ${gy11Subjects.length} Gy11 subjects`);

    // Fetch and save Gy25 data
    console.log('\nFetching Gy25 subjects list...');
    const gy25Data = await fetchData(ENDPOINTS.gy25.subjectsList);
    const gy25Subjects = await processSubjectsWithDetails(gy25Data, 'gy25');
    await saveContent(gy25Subjects, 'gy25');
    console.log(`Processed ${gy25Subjects.length} Gy25 subjects`);

    // Save new API metadata
    await saveAPIMetadata(currentMetadata);
    console.log('\nAll data fetched and saved successfully!');
  } catch (error) {
    console.error('Error in main process:', error);
    process.exit(1);
  }
}

main();
