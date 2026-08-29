# GitHub Actions & VPS Deployment Secrets

This document lists all the secrets and environment variables required to build, push to Docker Hub, and automatically deploy the application to your VPS (`13.229.171.117`).

---

## 1. How to add Secrets in GitHub

1. Open your repository on GitHub.
2. Go to **Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions**.
3. Click **New repository secret** for each item below.

---

## 2. Required GitHub Secrets

| Secret Name | Required | Example / Recommended Value | Description |
| :--- | :---: | :--- | :--- |
| `DOCKERHUB_USERNAME` | **Yes** | `devsrecipe` | Your Docker Hub account username. |
| `DOCKERHUB_TOKEN` | **Yes** | `dckr_pat_...` | Docker Hub Personal Access Token (with Read & Write permissions). |
| `VPS_HOST` | **Yes** | `13.229.171.117` | Your VPS public IP address. |
| `VPS_USERNAME` | **Yes** | `ubuntu` (or `root`) | SSH username for logging into your VPS. |
| `VPS_SSH_KEY` | **Yes** | `-----BEGIN OPENSSH PRIVATE KEY-----...` | Private SSH key (matching `~/.ssh/authorized_keys` on VPS). |
| `VPS_TARGET_DIR` | No | `/home/ubuntu/taskforge` | Deployment directory path on your VPS (default: `/home/ubuntu/taskforge`). |
| `VPS_PORT` | No | `22` | SSH port on VPS (default: `22`). |

---

## 3. Application Security & Database Secrets (Optional / Overridable)

These secrets are used to generate the `.env` file on your VPS automatically during deployment:

| Secret Name | Required | Default If Omitted | Description |
| :--- | :---: | :--- | :--- |
| `DB_ADMIN` | No | `admin` | MongoDB root username. |
| `DB_PASS` | No | `admin` | MongoDB root password. |
| `JWT_ACCESS_SECRET` | No | Auto-fallback | Access token signature secret (minimum 32 characters). |
| `JWT_REFRESH_SECRET` | No | Auto-fallback | Refresh token signature secret (minimum 32 characters). |
| `SESSION_SECRET` | No | Auto-fallback | Web cookie session secret (minimum 32 characters). |
| `EMAIL_TRANSPORT` | No | `console` | Email provider (`console`, `brevo`, or `smtp`). |

---

## 4. Pre-Requisites on Your VPS (`13.229.171.117`)

Ensure the following are installed and configured on your VPS before triggering the workflow:

1. **Docker & Docker Compose**:
   ```bash
   sudo apt-get update
   sudo apt-get install -y docker.io docker-compose-v2
   sudo usermod -aG docker $USER
   ```
2. **SSH Access**:
   - Make sure your public key is added to `~/.ssh/authorized_keys`.
   - Port `22` (SSH) and Port `80` (HTTP) must be open in your cloud firewall / security group.
