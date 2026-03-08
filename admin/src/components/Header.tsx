import { Burger, Group, Title, Box, Badge, ActionIcon, Menu } from '@mantine/core';
import { IconSettings, IconLogout, IconUser } from '@tabler/icons-react';

interface HeaderProps {
  opened: boolean;
  setOpened: (opened: boolean) => void;
}

export default function Header({ opened, setOpened }: HeaderProps) {
  return (
    <Box px="md" py="sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
      <Group gap="md">
        <Burger opened={opened} onClick={() => setOpened(!opened)} hiddenFrom="sm" size="sm" />
        <Group gap="xs" style={{ flexGrow: 1 }}>
          <Title order={2} style={{ fontSize: '1.5rem' }}>
            ⏱️ Kimai Sync
          </Title>
          <Badge color="blue" variant="light">
            Admin
          </Badge>
        </Group>
      </Group>

      <Group gap="md">
        <Badge color="green" variant="dot">
          Connected
        </Badge>
        <Menu shadow="md" width={200} position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="default" size="lg">
              <IconUser size={18} />
            </ActionIcon>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>Settings</Menu.Label>
            <Menu.Item leftSection={<IconSettings size={14} />}>
              Settings
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item leftSection={<IconLogout size={14} />} color="red">
              Logout
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Box>
  );
}
