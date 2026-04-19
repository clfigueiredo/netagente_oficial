FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      wireguard-tools \
      iproute2 \
      iptables \
      bash \
      iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# Enable IP forwarding at container start
CMD ["bash", "-c", "sysctl -w net.ipv4.ip_forward=1 2>/dev/null; for conf in /etc/wireguard/*.conf; do [ -f \"$conf\" ] && wg-quick up \"$(basename \"$conf\" .conf)\" 2>/dev/null; done; echo 'WireGuard ready'; sleep infinity"]
