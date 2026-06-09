import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import { AuthProvider } from "@/lib/auth";
import { AppLayout } from "@/components/shell/AppLayout";

import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Home from "@/pages/Home";
import CalendarPage from "@/pages/Calendar";
import Tasks from "@/pages/Tasks";
import Leave from "@/pages/Leave";
import PaymentRequests from "@/pages/PaymentRequests";
import PaymentApprovals from "@/pages/finance/PaymentApprovals";
import LeaveApprovals from "@/pages/hr/LeaveApprovals";
import AssignTask from "@/pages/hr/AssignTask";
import Parties from "@/pages/Parties";
import Audit from "@/pages/Audit";
import Resource from "@/pages/Resource";
import { Org, Coa, Approvals } from "@/pages/spine/Scaffold";
import Users from "@/pages/settings/Users";
import Roles from "@/pages/settings/Roles";
import Reference from "@/pages/settings/Reference";
import CrmPipeline from "@/pages/crm/Pipeline";
import Engagements from "@/pages/crm/Engagements";
import EngagementDetail from "@/pages/crm/EngagementDetail";
import Hub from "@/pages/procurement/Hub";
import Requisitions from "@/pages/procurement/Requisitions";
import RequisitionDetailPage from "@/pages/procurement/RequisitionDetailPage";
import POs from "@/pages/procurement/POs";
import PODetailPage from "@/pages/procurement/PODetailPage";
import Invoices from "@/pages/procurement/Invoices";
import InvoiceDetailPage from "@/pages/procurement/InvoiceDetailPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/leave" element={<Leave />} />
            <Route path="/payment-requests" element={<PaymentRequests />} />
            <Route path="/finance/payment-approvals" element={<PaymentApprovals />} />
            <Route path="/hr/assign-task" element={<AssignTask />} />
            <Route path="/hr/leave-approvals" element={<LeaveApprovals />} />
            <Route path="/parties" element={<Parties />} />
            <Route path="/org" element={<Org />} />
            <Route path="/coa" element={<Coa />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/r/:slug" element={<Resource />} />
            <Route path="/crm/pipeline" element={<CrmPipeline />} />
            <Route path="/crm/engagements" element={<Engagements />} />
            <Route path="/crm/engagements/:id" element={<EngagementDetail />} />

            <Route path="/procurement" element={<Hub />} />
            <Route path="/procurement/requisitions" element={<Requisitions />} />
            <Route path="/procurement/requisitions/:id" element={<RequisitionDetailPage />} />
            <Route path="/procurement/pos" element={<POs />} />
            <Route path="/procurement/pos/:id" element={<PODetailPage />} />
            <Route path="/procurement/invoices" element={<Invoices />} />
            <Route path="/procurement/invoices/:id" element={<InvoiceDetailPage />} />

            <Route path="/settings/users" element={<Users />} />
            <Route path="/settings/roles" element={<Roles />} />
            <Route path="/settings/reference" element={<Reference />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
