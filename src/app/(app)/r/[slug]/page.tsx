import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/spine/auth";
import { getResource } from "@/lib/spine/resources";
import { ResourceView } from "@/components/data/ResourceView";

export const dynamic = "force-dynamic";

export default async function ResourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resource = getResource(slug);
  if (!resource) notFound();

  const user = await requireUser();
  if (!can(user, `${resource.module}.view`)) {
    return <p className="text-sm text-zinc-500">You don&apos;t have access to {resource.title}.</p>;
  }

  return (
    <ResourceView
      resource={resource}
      caps={{
        create: can(user, `${resource.module}.create`),
        edit: can(user, `${resource.module}.edit`),
        del: can(user, `${resource.module}.delete`),
      }}
    />
  );
}
