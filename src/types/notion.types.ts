// Notion Types
export interface NotionTemplate {
  templateId?: string; // Optional identifier for the template
  projectId: number;
  propertyMap?: {
    title: string;
    date: string;
    duration: string;
    activity: string;
    tags?: string;
    project?: string;
    kimaiId: string;
  };
}

export interface NotionPagePayload {
  parent: {
    database_id: string;
  };
  properties: Record<string, any>;
  children?: any[];
  template?: any;
}

export interface NotionProperty {
  id: string;
  name: string;
  type: string;
}

export class NotionError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: Error,
  ) {
    super(message);
    this.name = 'NotionError';
  }
}
