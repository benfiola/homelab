#!/usr/bin/perl
use strict;
use warnings;
use Digest::SHA qw(sha1);
use Math::BigInt;

die "Usage: $0 <username> <password>\n" unless @ARGV == 2;

my $username = uc($ARGV[0]);
my $password = uc($ARGV[1]);

my $generator = Math::BigInt->new(7);
my $modulus   = Math::BigInt->new('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7');

open(my $urandom, '<:raw', '/dev/urandom') or die "Cannot open /dev/urandom: $!";
read($urandom, my $salt, 32);
close($urandom);

# verifier = generator ^ SHA1(salt || SHA1(username:password)) mod modulus  (integers are little-endian)
my $inner_hash    = sha1("${username}:${password}");
my $x_hash_le     = sha1($salt . $inner_hash);
my $x             = Math::BigInt->from_hex(unpack('H*', scalar reverse $x_hash_le));
my $verifier      = $generator->copy()->bmodpow($x, $modulus);

my $verifier_hex = $verifier->as_hex();
$verifier_hex =~ s/^0x//i;
$verifier_hex = ('0' x (64 - length($verifier_hex))) . $verifier_hex;
my $verifier_le = scalar reverse pack('H*', $verifier_hex);

my $salt_hex     = unpack('H*', $salt);
my $verifier_hex_le = unpack('H*', $verifier_le);

my $db_info = $ENV{AC_LOGIN_DATABASE_INFO} or die "AC_LOGIN_DATABASE_INFO is not set\n";
my ($db_host, $db_port, $db_user, $db_pass, $db_name) = split(/;/, $db_info);

my $sql = <<"SQL";
INSERT INTO account (username, salt, verifier, email, reg_mail, joindate, last_ip, last_attempt_ip, failed_logins, locked, lock_country, online, expansion, Flags, mutetime, mutereason, muteby, locale, os, recruiter, totaltime)
VALUES ('${username}', 0x${salt_hex}, 0x${verifier_hex_le}, '', '', NOW(), '127.0.0.1', '127.0.0.1', 0, 0, '00', 0, 2, 0, 0, '', '', 0, '', 0, 0);
SQL

local $ENV{MYSQL_PWD} = $db_pass;
open(my $mysql, '|-', 'mysql', '--protocol=TCP', '-h', $db_host, '-P', $db_port, '-u', $db_user, $db_name)
    or die "Cannot run mysql: $!";
print $mysql $sql;
close($mysql) or die "mysql exited with error\n";

print "Account '${username}' created successfully.\n";
