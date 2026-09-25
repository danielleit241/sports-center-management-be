import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const roles = ["CENTER_MANAGER", "COACH", "RECEPTIONIST", "MEMBER"];

async function main() {
  for (const name of roles) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }

  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { name: "CENTER_MANAGER" },
  });
  await prisma.user.upsert({
    where: { email: "manager123@sports-center.local" },
    update: { roleId: managerRole.id },
    create: {
      email: "manager@sports-center.local",
      phone: "0900000001",
      passwordHash: await bcrypt.hash("ChangeMe123!", 12),
      displayName: "Center Manager",
      roleId: managerRole.id,
    },
  });

  const memberRole = await prisma.role.findUniqueOrThrow({
    where: { name: "MEMBER" },
  });
  const member = await prisma.user.upsert({
    where: { email: "member@sports-center.local" },
    update: { roleId: memberRole.id },
    create: {
      email: "member@sports-center.local",
      phone: "0900000002",
      passwordHash: await bcrypt.hash("ChangeMe123!", 12),
      displayName: "Demo Member",
      roleId: memberRole.id,
    },
  });

  const now = new Date();

  let classSchedule = await prisma.classSchedule.findFirst({
    where: { courseName: "Functional Strength" },
  });
  if (!classSchedule) {
    const classDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startTime = new Date(classDate);
    startTime.setHours(18, 0, 0, 0);
    const endTime = new Date(classDate);
    endTime.setHours(19, 0, 0, 0);
    classSchedule = await prisma.classSchedule.create({
      data: {
        courseName: "Functional Strength",
        classDate,
        startTime,
        endTime,
        room: "Studio A",
        capacity: 12,
      },
    });
  }
  await prisma.classRegistration.deleteMany({
    where: { userId: member.id, classScheduleId: classSchedule.id },
  });

  // FR-003 Membership Packages Seed Data
  const packages = [
    {
      code: "PKG-GYM-1M",
      name: "Gói Gym Tiêu Chuẩn 1 Tháng",
      description:
        "Gói tập Gym cơ bản cho người mới bắt đầu, truy cập tự do toàn bộ thiết bị tạ và máy cardio.",
      price: 500000,
      durationDays: 30,
      sessionLimit: null,
      sportType: "Gym",
      benefits: JSON.stringify([
        "Tập luyện máy Gym không giới hạn",
        "Tủ đồ thông minh miễn phí",
        "Nước uống điện giải",
      ]),
      isBestSeller: false,
      status: "ACTIVE" as const,
    },
    {
      code: "PKG-YOGA-3M",
      name: "Gói Yoga Chuyên Sâu 3 Tháng",
      description:
        "Luyện tập Yoga cùng Master Ấn Độ, cải thiện độ dẻo dai và giải tỏa căng thẳng.",
      price: 1800000,
      durationDays: 90,
      sessionLimit: 36,
      sportType: "Yoga",
      benefits: JSON.stringify([
        "Thảm tập cao cấp kháng khuẩn",
        "Lớp Hatha & Vinyasa Yoga",
        "Trà thảo mộc sau buổi tập",
      ]),
      isBestSeller: true,
      status: "ACTIVE" as const,
    },
    {
      code: "PKG-VIP-1Y",
      name: "Gói VIP Full-Access 1 Năm",
      description:
        "Đặc quyền thượng lưu tập luyện không giới hạn mọi bộ môn tại tất cả chi nhánh.",
      price: 6000000,
      durationDays: 365,
      sessionLimit: null,
      sportType: "Toàn diện",
      benefits: JSON.stringify([
        "Toàn quyền truy cập mọi bộ môn",
        "Phòng xông hơi đá muối Himalaya",
        "Đặt chỗ lớp ưu tiên",
        "3 buổi PT cá nhân 1-1",
      ]),
      isBestSeller: true,
      status: "ACTIVE" as const,
    },
  ];

  for (const pkg of packages) {
    await prisma.membershipPackage.upsert({
      where: { code: pkg.code },
      update: pkg,
      create: pkg,
    });
  }

  const yoga = await prisma.membershipPackage.findUniqueOrThrow({
    where: { code: "PKG-YOGA-3M" },
  });
  const membership = await prisma.membership.findFirst({
    where: { userId: member.id },
    orderBy: { id: "asc" },
  });
  const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const membershipData = {
    packageId: yoga.id,
    packageNameSnapshot: yoga.name,
    sportTypeSnapshot: yoga.sportType,
    durationDaysSnapshot: yoga.durationDays,
    listedPriceSnapshot: yoga.price,
    startDate,
    endDate: new Date(
      startDate.getTime() + yoga.durationDays * 24 * 60 * 60 * 1000,
    ),
    status: "ACTIVE" as const,
  };
  if (membership)
    await prisma.membership.update({
      where: { id: membership.id },
      data: membershipData,
    });
  else
    await prisma.membership.create({
      data: { userId: member.id, ...membershipData },
    });
}

main().finally(() => prisma.$disconnect());
