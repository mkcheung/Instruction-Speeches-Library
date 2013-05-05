<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("userrole.php");
require_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}


$users = User::find_all();
	echo("<div class=\"span7\">");
	echo "<table class=\"table\">";
	echo "<thead>";
	echo "<tr>";
	echo "<th>Users";
	echo "</th>";
	echo "</tr>";
	echo "<tr>";
	echo "<th>First Name</th>";
	echo "<th>Last Name</th>";
	echo "<th>User Name</th>";
	echo "<th>Role</th>";
	echo "<th>E-Mail</th>";
	echo "<th>Actions</th>" ;
	echo "</tr>";
	echo "</thead>";
	echo "<tbody>";
	if($users){
		foreach($users as $user){
			$userRole = UserRole::find_by_id($user->user_role_id);
			echo "<tr>";
			echo "<td>" . $user->first_name . "</td>";
			echo "<td>" . $user->last_name . "</td>";
			echo "<td>" . $user->username . "</td>";
			echo "<td>" . $userRole->role . "</td>";
			echo "<td>" . $user->email . "</td>";
			echo "<td><a id=\"editUser-" . $user->id . "\" href=\"editUser.php?userid=" . $user->id . "\"><button type=\"button\" class=\"btn btn-warning\">Edit</button></a>" . ' ' . 
			     "<a id=\"deleteUser-" . $user->id . "\" href=\"deleteUser.php?userid=" . $user->id . "\"><button type=\"button\" class=\"btn btn-danger\">Delete</button>". "</td>";
			echo "</tr>";
		}
	}
	echo "</tbody>";
	echo "</table>";
	echo "</div>";

include_once("footer.php");
?>
<script>
	$("#userListingBlock").unbind();
	$('#userListingBlock').on("click",'a[id*="editUser"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('6a');

		id = $(this).attr('id');
		userIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		
		$('#addEditUserBlock').load('editUser.php', {userid:userIdValue});

	});

	$('#userListingBlock').on("click",'a[id*="deleteUser"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('delete user');

		id = $(this).attr('id');
		userIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		deleteUserData(userIdValue);
	});

	function deleteUserData(userId){
		//alert(userId);
		$.ajax({
			type:'POST',
			url: 'userDelete.php',
			data:{userid:userId},
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">User Deleted!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#settingsControls").load("userALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">This user could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="userRegistrationForm"]')[0].reset();
			}
		});
	};
</script>
