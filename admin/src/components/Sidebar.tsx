import { NavLink, Stack } from '@mantine/core';
import { IconHome, IconRefresh, IconFolders, IconSettings } from '@tabler/icons-react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const links = [
    { Icon: IconHome, label: 'Dashboard', path: '/' },
    { Icon: IconRefresh, label: 'Sync Status', path: '/sync-status' },
    { Icon: IconFolders, label: 'Projects', path: '/projects' },
    { Icon: IconSettings, label: 'Settings', path: '/settings' },
  ];

  return (
    <Stack gap="xs" p="md">
      {links.map((link) => (
        <NavLink
          key={link.path}
          label={link.label}
          leftSection={<link.Icon size={16} />}
          onClick={() => navigate(link.path)}
          active={location.pathname === link.path}
          color="blue"
        />
      ))}
    </Stack>
  );
}
