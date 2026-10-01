import { GuidedStudio } from '../../../features/creator/GuidedStudio';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <GuidedStudio key={projectId} projectId={projectId} />;
}
