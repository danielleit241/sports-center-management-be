export const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Sports Center Management System API',
    version: '0.1.0',
    description: 'API cho xác thực và đăng ký lớp học của Sports Center Management System.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  tags: [
    { name: 'Health', description: 'Service status' },
    { name: 'Authentication', description: 'Đăng nhập và quản lý session' },
    { name: 'Class registration', description: 'Danh sách và đăng ký lớp học cho member' },
    { name: 'Package management', description: 'Cấu hình danh mục gói tập và thời hạn sử dụng (FR-003)' },
    { name: 'Membership subscription', description: 'Đăng ký và xem lịch sử gói tập của member' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } },
        required: ['code', 'message'],
      },
      LoginRequest: {
        type: 'object',
        required: ['identifier', 'password'],
        properties: { identifier: { type: 'string', example: 'member@sports-center.local' }, password: { type: 'string', format: 'password', example: 'ChangeMe123!' } },
      },
      ClassSchedule: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, courseName: { type: 'string' }, classDate: { type: 'string', format: 'date-time' },
          startTime: { type: 'string', format: 'date-time' }, endTime: { type: 'string', format: 'date-time' },
          room: { type: 'string' }, capacity: { type: 'integer' }, availableSlots: { type: 'integer' },
        },
      },
      RegistrationRequest: { type: 'object', required: ['classId'], properties: { classId: { type: 'integer', minimum: 1, example: 1 } } },
      Registration: {
        type: 'object',
        properties: { id: { type: 'integer' }, classId: { type: 'integer' }, status: { type: 'string', example: 'CONFIRMED' }, registeredAt: { type: 'string', format: 'date-time' } },
      },
      Membership: {
        type: 'object', required: ['id', 'packageId', 'packageName', 'sportType', 'durationDays', 'listedPrice', 'startDate', 'endDate', 'status'],
        properties: {
          id: { type: 'integer' }, packageId: { type: 'integer', nullable: true }, packageName: { type: 'string', nullable: true },
          sportType: { type: 'string', nullable: true }, durationDays: { type: 'integer', nullable: true }, listedPrice: { type: 'integer', nullable: true },
          startDate: { type: 'string', format: 'date-time' }, endDate: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'] },
        },
      },
      MembershipRegistrationRequest: { type: 'object', required: ['packageId'], properties: { packageId: { type: 'integer', minimum: 1, example: 2 } } },
      MembershipPackage: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          code: { type: 'string', example: 'PKG-GYM-1M' },
          name: { type: 'string', example: 'Gói Gym Tiêu Chuẩn 1 Tháng' },
          description: { type: 'string', nullable: true, example: 'Tập gym không giới hạn máy móc' },
          price: { type: 'integer', example: 500000 },
          durationDays: { type: 'integer', example: 30 },
          sessionLimit: { type: 'integer', nullable: true, example: null },
          sportType: { type: 'string', example: 'Gym' },
          benefits: { type: 'array', items: { type: 'string' }, example: ['Tủ đồ thông minh', 'Nước uống điện giải'] },
          isBestSeller: { type: 'boolean', example: false },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], example: 'ACTIVE' },
          activeSubscribers: { type: 'integer', example: 0 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CreatePackageRequest: {
        type: 'object',
        required: ['code', 'name', 'price', 'durationDays', 'sportType'],
        properties: {
          code: { type: 'string', example: 'PKG-BOX-3M' },
          name: { type: 'string', example: 'Gói Boxing 3 Tháng' },
          description: { type: 'string', example: 'Tập luyện kỹ năng đấm bốc căn bản' },
          price: { type: 'integer', minimum: 1, example: 2500000 },
          durationDays: { type: 'integer', minimum: 1, example: 90 },
          sessionLimit: { type: 'integer', minimum: 1, nullable: true, example: 36 },
          sportType: { type: 'string', example: 'Boxing' },
          benefits: { type: 'array', items: { type: 'string' }, example: ['Găng tay tập luyện', 'Nước điện giải'] },
          isBestSeller: { type: 'boolean', example: false },
        },
      },
      UpdatePackageRequest: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'integer', minimum: 1 },
          durationDays: { type: 'integer', minimum: 1 },
          sessionLimit: { type: 'integer', minimum: 1, nullable: true },
          sportType: { type: 'string' },
          benefits: { type: 'array', items: { type: 'string' } },
          isBestSeller: { type: 'boolean' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: { tags: ['Health'], summary: 'Kiểm tra trạng thái API', responses: { '200': { description: 'API đang hoạt động' } } },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'], summary: 'Đăng nhập', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
        responses: { '200': { description: 'Đăng nhập thành công' }, '401': { description: 'Sai thông tin đăng nhập', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }, '422': { description: 'Dữ liệu không hợp lệ' } },
      },
    },
    '/api/auth/refresh': {
      post: { tags: ['Authentication'], summary: 'Refresh access token', responses: { '200': { description: 'Token mới' }, '401': { description: 'Refresh token không hợp lệ' } } },
    },
    '/api/auth/logout': {
      post: { tags: ['Authentication'], summary: 'Đăng xuất', responses: { '204': { description: 'Đăng xuất thành công' } } },
    },
    '/api/auth/me': {
      get: { tags: ['Authentication'], summary: 'Lấy session hiện tại', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Thông tin session' }, '401': { description: 'Chưa đăng nhập' } } },
    },
    '/api/classes': {
      get: { tags: ['Class registration'], summary: 'Lấy các lớp đang mở', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Danh sách lớp', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ClassSchedule' } } } } }, '401': { description: 'Chưa đăng nhập' }, '403': { description: 'Chỉ member được truy cập' } } },
    },
    '/api/class-registrations': {
      post: {
        tags: ['Class registration'], summary: 'Đăng ký lớp học', description: 'Kiểm tra gói tập còn hiệu lực, không trùng lịch và còn slot.', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegistrationRequest' } } } },
        responses: { '201': { description: 'Đăng ký thành công', content: { 'application/json': { schema: { $ref: '#/components/schemas/Registration' } } } }, '403': { description: 'Gói tập hết hạn hoặc không đủ quyền' }, '409': { description: 'Lớp đầy, trùng lịch hoặc đã đăng ký' }, '422': { description: 'Dữ liệu không hợp lệ' } },
      },
    },
    '/api/memberships': {
      get: {
        tags: ['Membership subscription'], summary: 'Lấy membership của member hiện tại', security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Lịch sử membership mới nhất trước', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Membership' } } } } }, '401': { description: 'Chưa đăng nhập' }, '403': { description: 'Chỉ member được truy cập' } },
      },
      post: {
        tags: ['Membership subscription'], summary: 'Đăng ký gói tập và kích hoạt ngay', description: 'Không thu hoặc xác minh thanh toán trong hệ thống. Gói cùng bộ môn đang còn hiệu lực bị chặn; Toàn diện xung đột mọi bộ môn.', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MembershipRegistrationRequest' } } } },
        responses: { '201': { description: 'Đã kích hoạt membership', content: { 'application/json': { schema: { $ref: '#/components/schemas/Membership' } } } }, '401': { description: 'Chưa đăng nhập' }, '403': { description: 'Chỉ member được truy cập' }, '404': { description: 'Không tìm thấy gói' }, '409': { description: 'Gói không khả dụng hoặc trùng membership bộ môn' }, '422': { description: 'Dữ liệu không hợp lệ' } },
      },
    },
    '/api/packages': {
      get: {
        tags: ['Package management'], summary: 'Lấy danh mục gói tập', description: 'Public xem các gói ACTIVE; Center Manager xem tất cả trạng thái.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED', 'ALL'] }, description: 'Lọc trạng thái' },
          { name: 'sportType', in: 'query', schema: { type: 'string' }, description: 'Lọc theo bộ môn' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Tìm theo tên, mã hoặc mô tả' },
        ],
        responses: { '200': { description: 'Danh sách gói tập', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/MembershipPackage' } } } } } },
      },
      post: {
        tags: ['Package management'], summary: 'Tạo gói tập mới (Center Manager)', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePackageRequest' } } } },
        responses: {
          '201': { description: 'Tạo gói thành công', content: { 'application/json': { schema: { $ref: '#/components/schemas/MembershipPackage' } } } },
          '400': { description: 'Dữ liệu không hợp lệ', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Chưa đăng nhập' },
          '403': { description: 'Chỉ Center Manager có quyền' },
          '409': { description: 'Mã gói đã tồn tại' },
        },
      },
    },
    '/api/packages/{id}': {
      get: {
        tags: ['Package management'], summary: 'Xem chi tiết một gói tập',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Thông tin gói tập', content: { 'application/json': { schema: { $ref: '#/components/schemas/MembershipPackage' } } } },
          '404': { description: 'Không tìm thấy gói tập' },
        },
      },
      patch: {
        tags: ['Package management'], summary: 'Chỉnh sửa cấu hình gói tập (Center Manager)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdatePackageRequest' } } } },
        responses: {
          '200': { description: 'Cập nhật thành công', content: { 'application/json': { schema: { $ref: '#/components/schemas/MembershipPackage' } } } },
          '400': { description: 'Dữ liệu không hợp lệ' },
          '401': { description: 'Chưa đăng nhập' },
          '403': { description: 'Chỉ Center Manager có quyền' },
          '404': { description: 'Không tìm thấy gói tập' },
        },
      },
      delete: {
        tags: ['Package management'], summary: 'Lưu trữ / Hủy kích hoạt gói tập (Center Manager)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Đã lưu trữ gói' },
          '401': { description: 'Chưa đăng nhập' },
          '403': { description: 'Chỉ Center Manager có quyền' },
          '404': { description: 'Không tìm thấy gói tập' },
          '409': { description: 'Không thể xóa gói đã có thành viên đăng ký' },
        },
      },
    },
    '/api/packages/{id}/activate': {
      post: {
        tags: ['Package management'], summary: 'Kích hoạt phát hành gói tập (Center Manager)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Kích hoạt thành công', content: { 'application/json': { schema: { $ref: '#/components/schemas/MembershipPackage' } } } },
          '401': { description: 'Chưa đăng nhập' },
          '403': { description: 'Chỉ Center Manager có quyền' },
          '404': { description: 'Không tìm thấy gói tập' },
        },
      },
    },
    '/api/packages/{id}/deactivate': {
      post: {
        tags: ['Package management'], summary: 'Tạm dừng phát hành gói tập (Center Manager)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Tạm dừng thành công', content: { 'application/json': { schema: { $ref: '#/components/schemas/MembershipPackage' } } } },
          '401': { description: 'Chưa đăng nhập' },
          '403': { description: 'Chỉ Center Manager có quyền' },
          '404': { description: 'Không tìm thấy gói tập' },
        },
      },
    },
  },
} as const
