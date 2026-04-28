import StaffProfilePage from "@/app/(staff)/staff/profile/page";

// The /admin/profile and /staff/profile pages render identical content —
// both are self-service "My Profile" surfaces, scoped to the signed-in
// user regardless of role. Keeping them as two routes lets each back-office
// keep its own accent shell without cross-portal navigation.
export default StaffProfilePage;
