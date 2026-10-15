import { clerkClient } from "@clerk/nextjs/server";

const PAGE_SIZE = 100;

export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const clerk = await clerkClient();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await clerk.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: PAGE_SIZE,
      offset,
    });
    if (data.some((m) => m.publicUserData?.userId === userId)) return true;
    if (data.length < PAGE_SIZE) return false;
  }
}
