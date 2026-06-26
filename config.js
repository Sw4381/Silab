// config.js - Firebase / Cloudinary 공통 설정 (단일 진실 공급원)
var firebaseConfig = {
    apiKey: "AIzaSyC1HQOuTGQ5IaLQiSRitcM2NsaYxtAmDQk",
    authDomain: "security-lab-projects-4d1cb.firebaseapp.com",
    databaseURL: "https://security-lab-projects-4d1cb-default-rtdb.firebaseio.com",
    projectId: "security-lab-projects-4d1cb",
    storageBucket: "security-lab-projects-4d1cb.firebasestorage.app",
    messagingSenderId: "1075416037204",
    appId: "1:1075416037204:web:89db47137971d40485bac1",
    measurementId: "G-JH2LH2CS3K"
};

var CLOUDINARY_CLOUD_NAME = 'dtgwtdf3q';
var CLOUDINARY_UPLOAD_PRESET = 'jfwl9ton';
var ALLOWED_EMAIL = 'kinjecs0@gmail.com';   // 공개 페이지(멤버/논문 등) 관리자 — 기존 유지

// 재무(예산/인건비)·실적 페이지는 이메일 대신 UID로 식별 (이메일 비노출)
//   일반 관리자: kinjecs0@gmail.com
//   Root(학생인건비 전용 상위): admin_kinjecs0@gmail.com
var ADMIN_UID = 'vXGv4tLnkzUfNbKHMm8c8cGQ4Z03';   // 일반 관리자
var ROOT_UID  = '3aEjEgu6XTa5DCBIUxt22wjKrnr2';   // Root (학생인건비 전용)
// ⚠ 학생인건비 실차단은 Firebase DB 규칙에서 payroll 노드를 ROOT_UID 로 잠가야 완성됨
