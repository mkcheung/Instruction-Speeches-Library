<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("userrole.php");
include_once("header.php");

$userRoles = UserRole::find_all();

	echo("<div class=\"span7\">");
	echo "<table class=\"table\">";
	echo "<thead>";
	echo "<tr>";
	echo "<th>Roles";
	echo "</th>";
	echo "</tr>";
	echo "<tr>";
	echo "<th>Role</th>";
	echo "<th>Actions</th>" ;
	echo "</tr>";
	echo "</thead>";
	echo "<tbody>";
	if($userRoles){
		foreach($userRoles as $userRole){
			echo "<tr>";
			echo "<td>" . $userRole->role . "</td>";
			echo "<td><a id=\"editRole-" . $userRole->id . "\" href=\"editRole.php?userRoleId=" . $userRole->id . "\"><button type=\"button\" class=\"btn btn-warning\">Edit</button></a>" . ' ' . 
			     "<a id=\"deleteRole-" . $userRole->id . "\" href=\"deleteRole.php?userRoleId=" . $userRole->id . "\"><button type=\"button\" class=\"btn btn-danger\">Delete</button>". "</td>";
			echo "</tr>";
		}
	}
	echo "</tbody>";
	echo "</table>";
	echo "</div>";

include_once("footer.php");
?>
<script>
	$('#userRoleListingBlock').unbind();
	$('#userRoleListingBlock').on('click','a[id*="editRole"]',function(e){
		e.preventDefault();
		e.stopPropagation();
		//alert('13');

		id = $(this).attr('id');
		userRoleIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		$('#addEditRoleBlock').load('editRole.php', {userRoleId:userRoleIdValue});
	
	});


	$('#userRoleListingBlock').on("click",'a[id*="deleteRole"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('delete role');

		id = $(this).attr('id');
		roleIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		deleteRoleData(roleIdValue);
	});

	function deleteRoleData(roleIdValue){
		$.ajax({
			type:'POST',
			url: 'roleDelete.php',
			data:{roleid:roleIdValue},
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Success!</div>');
				$("#settingsControls").load("userRoleALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Ajax problems.</div>');
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="userRoleInputForm"]')[0].reset();
			}
		});
	};

</script>