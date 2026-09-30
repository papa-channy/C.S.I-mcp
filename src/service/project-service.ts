import type { Project, SecurityRepository } from "../core/repository.js";
import type { ProjectProfile } from "../core/applicability.js";
import { withNotFound } from "./errors.js";
import { generateUuid } from "./ids.js";

export interface CreateProjectInput {
  name: string;
  owner: string;
  securityLevel: string;
  exposure: string[];
  features: Record<string, boolean>;
  technologies: ProjectProfile["technologies"];
  components?: string[];
  identities?: string[];
  dataClasses?: string[];
}

export type ProjectProfilePatch = Partial<{
  securityLevel: string;
  exposure: string[];
  features: Record<string, boolean>;
  technologies: ProjectProfile["technologies"];
  components: string[];
  identities: string[];
  dataClasses: string[];
}>;

export class ProjectService {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const profile: ProjectProfile = {
      securityLevel: input.securityLevel,
      exposure: input.exposure,
      features: input.features,
      technologies: input.technologies,
      ...(input.components !== undefined ? { components: input.components } : {}),
      ...(input.identities !== undefined ? { identities: input.identities } : {}),
      ...(input.dataClasses !== undefined ? { dataClasses: input.dataClasses } : {}),
    };
    const project: Project = {
      projectId: generateUuid(),
      name: input.name,
      owner: input.owner,
      createdAt: this.now(),
      profileRevision: 1,
      profile,
    };
    await this.repository.saveProject(project);
    return project;
  }

  async getProject(projectId: string): Promise<Project> {
    return withNotFound(this.repository.getProject(projectId), `Project "${projectId}" not found`, { projectId });
  }

  // Distinguishes "key absent from patch" (leave untouched) from "key present as []" (KNOWN-NONE)
  // via `"key" in patch` — a `patch.components ?? existing` fallback would collapse both cases into
  // one, the exact three-valued-profile bug this project's practice forbids one layer down.
  async updateProjectProfile(projectId: string, patch: ProjectProfilePatch): Promise<Project> {
    const project = await this.getProject(projectId);
    const profile: ProjectProfile = { ...project.profile };

    if ("securityLevel" in patch) profile.securityLevel = patch.securityLevel!;
    if ("exposure" in patch) profile.exposure = patch.exposure!;
    if ("features" in patch) profile.features = patch.features!;
    if ("technologies" in patch) profile.technologies = patch.technologies!;
    if ("components" in patch) profile.components = patch.components!;
    if ("identities" in patch) profile.identities = patch.identities!;
    if ("dataClasses" in patch) profile.dataClasses = patch.dataClasses!;

    const updated: Project = { ...project, profileRevision: project.profileRevision + 1, profile };
    await this.repository.saveProject(updated);
    return updated;
  }
}
